import { NextResponse } from "next/server";
import { adminAuthorized } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { foodKey } from "@/lib/food-names";

export const runtime = "nodejs";

// 管理页：共享食物库的查询、修改、新增、删除。手动改过或新增的记为 source = 'manual'，AI 定时重估会跳过。
const PAGE = 50;
const FIELDS = "name, display_name, calories_100g, protein_100g, carbs_100g, fat_100g, source, uses, needs_refresh, updated_at";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const denied = () => json({ error: "管理密钥不正确。" }, 401);

function nutrients(body: Record<string, unknown>) {
  const n = (k: string, max: number) => { const v = Number(body[k]); return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : null; };
  const values = { calories_100g: n("calories_100g", 900), protein_100g: n("protein_100g", 100), carbs_100g: n("carbs_100g", 100), fat_100g: n("fat_100g", 100) };
  return Object.values(values).every((v) => v !== null) ? (values as Record<string, number>) : null;
}

export async function GET(request: Request) {
  if (!adminAuthorized(request)) return denied();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
  const source = url.searchParams.get("source") || "";
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
  let query = createAdminClient().from("food_library").select(FIELDS, { count: "exact" });
  if (q) { const like = `%${q.replace(/[%_,()]/g, "")}%`; query = query.or(`display_name.ilike.${like},name.ilike.${like},name.ilike.%${foodKey(q).replace(/[%_,()]/g, "")}%`); }
  if (["cfct", "ai", "photo", "manual"].includes(source)) query = query.eq("source", source);
  const { data, count, error } = await query.order("uses", { ascending: false }).order("display_name").range(page * PAGE, page * PAGE + PAGE - 1);
  if (error) return json({ error: error.message }, 500);
  return json({ rows: data, total: count ?? 0, pageSize: PAGE });
}

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return denied();
  const body = await request.json().catch(() => ({}));
  const display = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 60) : "";
  const n = nutrients(body);
  if (!display || !n) return json({ error: "请填写名称和四项营养（每 100 克）。" }, 400);
  const name = foodKey(display);
  const admin = createAdminClient();
  const { data: exists } = await admin.from("food_library").select("display_name").eq("name", name).maybeSingle();
  if (exists) return json({ error: `库里已有同一种食物：${exists.display_name}（库键 ${name}），请直接修改它。` }, 409);
  const { error } = await admin.from("food_library").insert({ name, display_name: display, ...n, source: "manual" });
  return error ? json({ error: error.message }, 500) : json({ ok: true, name });
}

export async function PATCH(request: Request) {
  if (!adminAuthorized(request)) return denied();
  const body = await request.json().catch(() => ({}));
  const n = nutrients(body);
  const display = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 60) : "";
  if (typeof body.name !== "string" || !display || !n) return json({ error: "名称和四项营养都要填写。" }, 400);
  const { error } = await createAdminClient().from("food_library").update({ display_name: display, ...n, source: "manual", needs_refresh: false, updated_at: new Date().toISOString() }).eq("name", body.name);
  return error ? json({ error: error.message }, 500) : json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!adminAuthorized(request)) return denied();
  const body = await request.json().catch(() => ({}));
  if (typeof body.name !== "string") return json({ error: "缺少库键。" }, 400);
  const { error } = await createAdminClient().from("food_library").delete().eq("name", body.name);
  return error ? json({ error: error.message }, 500) : json({ ok: true });
}
