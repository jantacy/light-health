import type { SupabaseClient } from "@supabase/supabase-js";

// 饭点提醒的订阅管理（浏览器端）。iOS 需 16.4+，且必须从主屏幕图标打开才有 PushManager。
const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!KEY;

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function reminderEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  return !!(await currentSubscription());
}

const toBytes = (b64: string) => Uint8Array.from(atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// 开启：申请通知权限 → 订阅 → 存到 push_subscriptions。失败时抛出可直接展示的提示。
export async function enableReminder(supabase: SupabaseClient, userId: string) {
  if (!pushSupported()) throw new Error("当前环境不支持通知。iPhone 需 iOS 16.4 以上，并从主屏幕图标打开轻食记。");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("没有通知权限。请在系统设置里允许轻食记发送通知。");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(KEY) }));
  const { keys } = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({ endpoint: sub.endpoint, user_id: userId, p256dh: keys?.p256dh, auth: keys?.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai" });
  if (error) throw new Error("开启失败，请稍后重试。");
}

// 关闭（也在退出登录前调用）：删掉本机订阅，换账号后不会收到前一个账号的提醒。
export async function disableReminder(supabase: SupabaseClient) {
  if (!pushSupported()) return;
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
