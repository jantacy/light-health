import { NextResponse } from "next/server";
import { adminAuthorized } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/date";

export const runtime = "nodejs";

// 管理页：按手机号查用户。?q= 模糊搜索手机号；?phone=&days= 返回该用户的资料、License 状态和最近 N 天的记录。
// 不返回 License 哈希；照片给 1 小时有效的签名链接。
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!adminAuthorized(request)) return json({ error: "管理密钥不正确。" }, 401);
  const url = new URL(request.url);
  const admin = createAdminClient();

  const q = (url.searchParams.get("q") ?? "").replace(/[^\d+]/g, "");
  if (url.searchParams.has("q")) {
    let query = admin.from("user_licenses").select("phone, status, user_id, created_at").order("created_at");
    if (q) query = query.ilike("phone", `%${q}%`);
    const { data: licenses, error } = await query.limit(20);
    if (error) return json({ error: error.message }, 500);
    const phones = (licenses ?? []).map((l) => l.phone);
    const { data: profiles } = phones.length ? await admin.from("user_profiles").select("phone, nickname").in("phone", phones) : { data: [] };
    const names = new Map((profiles ?? []).map((p) => [p.phone, p.nickname]));
    return json({ users: (licenses ?? []).map((l) => ({ phone: l.phone, status: l.status, registered: !!l.user_id, nickname: names.get(l.phone) ?? null })) });
  }

  const phone = url.searchParams.get("phone") ?? "";
  const days = [7, 14, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 14;
  const { data: license } = await admin.from("user_licenses").select("phone, status, user_id, created_at, updated_at").eq("phone", phone).maybeSingle();
  if (!license) return json({ error: "没有这个手机号。" }, 404);
  const { data: profile } = await admin.from("user_profiles").select("nickname, gender, birth_month, birth_day, calorie_goal, target_weight, theme, updated_at").eq("phone", phone).maybeSingle();
  if (!license.user_id) return json({ license, profile, auth: null, summary: null, meals: [], weights: [], days });

  const uid = license.user_id;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }); // 服务器时区可能不是北京时间
  const from = addDays(today, -(days - 1));
  const fromTs = new Date(`${from}T00:00:00+08:00`).toISOString();
  const [authUser, meals, weights, mealCount, firstMeal, lastMeal, weightCount] = await Promise.all([
    admin.auth.admin.getUserById(uid),
    admin.from("meal_records").select("id, eaten_at, meal_type, title, calories, protein_g, carbs_g, fat_g, notes, image_path, dishes, created_at").eq("user_id", uid).gte("eaten_at", fromTs).order("eaten_at", { ascending: false }),
    admin.from("weight_records").select("recorded_on, weight_kg").eq("user_id", uid).gte("recorded_on", from).order("recorded_on", { ascending: false }),
    admin.from("meal_records").select("id", { count: "exact", head: true }).eq("user_id", uid),
    admin.from("meal_records").select("eaten_at").eq("user_id", uid).order("eaten_at").limit(1),
    admin.from("meal_records").select("eaten_at").eq("user_id", uid).order("eaten_at", { ascending: false }).limit(1),
    admin.from("weight_records").select("id", { count: "exact", head: true }).eq("user_id", uid)
  ]);
  if (meals.error || weights.error) return json({ error: (meals.error ?? weights.error)!.message }, 500);

  // 照片签名链接（饮食照片存在私有 bucket）。
  const paths = [...new Set((meals.data ?? []).flatMap((m) => [m.image_path, ...((m.dishes ?? []) as { image_path: string | null }[]).map((d) => d.image_path)]).filter((p): p is string => !!p))];
  const photos: Record<string, string> = {};
  if (paths.length) {
    const { data } = await admin.storage.from("meal-photos").createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) photos[s.path] = s.signedUrl;
  }

  return json({
    license, profile, days, photos,
    auth: authUser.data.user ? { created_at: authUser.data.user.created_at, last_sign_in_at: authUser.data.user.last_sign_in_at } : null,
    summary: { meals: mealCount.count ?? 0, weights: weightCount.count ?? 0, first: firstMeal.data?.[0]?.eaten_at ?? null, last: lastMeal.data?.[0]?.eaten_at ?? null },
    meals: meals.data, weights: weights.data
  });
}
