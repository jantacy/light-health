import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

// 饭点提醒：每分钟检查一次，到点后 WINDOW 分钟内（容忍服务重启）认领“用户+当天+这一餐”，
// 当天这一餐还没记录就推送到该用户的所有设备。认领靠 meal_reminders_sent 主键，多台服务器同时运行也只发一次。
const REMINDERS = [
  { meal: "breakfast", at: "08:30", label: "早饭" },
  { meal: "lunch", at: "12:30", label: "午饭" },
  { meal: "dinner", at: "20:00", label: "晚饭" }
] as const;
const WINDOW = 60;

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string; tz: string };

// 某时区的当前日期（YYYY-MM-DD）和当天第几分钟；时区无效时按北京时间。
function localNow(tz: string, now = new Date()) {
  const parts = (zone: string) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  let p; try { p = parts(tz); } catch { p = parts("Asia/Shanghai"); }
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const localDayIn = (iso: string, tz: string) => localNow(tz, new Date(iso)).day;

export async function tick(now = new Date()) {
  const admin = createAdminClient();
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, user_id, p256dh, auth, tz");
  if (error) { console.error("[meal-reminders] subs", error.message); return; }
  const byUser = new Map<string, Sub[]>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  for (const [userId, list] of byUser) {
    const tz = list[0].tz; // 同一用户的设备一般在同一时区，按第一台算
    const { day, minutes } = localNow(tz, now);
    for (const r of REMINDERS) {
      const since = minutes - toMinutes(r.at);
      if (since < 0 || since >= WINDOW) continue;
      const { data: claimed, error: claimError } = await admin.from("meal_reminders_sent").upsert({ user_id: userId, day, meal_type: r.meal }, { onConflict: "user_id,day,meal_type", ignoreDuplicates: true }).select();
      if (claimError) { console.error("[meal-reminders] claim", claimError.message); continue; }
      if (!claimed?.length) continue;
      // 只取最近 24 小时的这一餐，再按用户时区判断是不是“今天”
      const { data: meals } = await admin.from("meal_records").select("eaten_at").eq("user_id", userId).eq("meal_type", r.meal).gte("eaten_at", new Date(now.getTime() - 86400000).toISOString());
      if (meals?.some((m) => localDayIn(m.eaten_at, tz) === day)) continue;
      const payload = JSON.stringify({ title: `该记录${r.label}啦`, body: `今天的${r.label}还没记录，点这里记一下。`, tag: `meal-${r.meal}`, url: "/" });
      for (const s of list) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: WINDOW * 60 });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // 订阅已失效（卸载、关闭通知）
          else console.error("[meal-reminders] send", status, err instanceof Error ? err.message : err);
        }
      }
      console.log(`[meal-reminders] ${userId} ${day} ${r.meal} → ${list.length} 台设备`);
    }
  }
  await admin.from("meal_reminders_sent").delete().lt("day", new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10));
}

let started = false;
export function startMealReminders() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_SUBJECT;
  if (started || !process.env.SUPABASE_SERVICE_ROLE_KEY || !pub || !priv || !subject) return;
  started = true;
  webpush.setVapidDetails(subject, pub, priv);
  const run = () => tick().catch((err) => console.error("[meal-reminders]", err));
  setTimeout(() => { run(); setInterval(run, 60 * 1000); }, 30 * 1000);
}
