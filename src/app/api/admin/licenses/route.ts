import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.LICENSE_ADMIN_SECRET || "";
  const supplied = request.headers.get("x-license-admin-key") || "";
  if (!expected || expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "管理密钥不正确。" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  if (!phone) return NextResponse.json({ error: "手机号格式不正确，例如 13800000000 或 +8613800000000。" }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { count, error: countError } = await admin.from("user_licenses").select("id", { count: "exact", head: true }).neq("status", "revoked").neq("phone", phone);
    if (countError) throw countError;
    if ((count || 0) >= 10) return NextResponse.json({ error: "已达到 10 个受邀手机号上限。" }, { status: 409 });

    const license = `FOOD-${randomBytes(24).toString("base64url")}`;
    const license_hash = createHash("sha256").update(license).digest("hex");
    const { data: previous } = await admin.from("user_licenses").select("user_id").eq("phone", phone).maybeSingle();
    if (previous?.user_id) {
      const { error: revokeError } = await admin.auth.admin.updateUserById(previous.user_id, { ban_duration: "876000h" });
      if (revokeError) throw revokeError;
    }
    const { error } = await admin.from("user_licenses").upsert({ phone, license_hash, status: "active", updated_at: new Date().toISOString() }, { onConflict: "phone" });
    if (error) throw error;
    return NextResponse.json({ license, phone, message: "请立即复制并转交给该手机号的使用者。此 License 只展示一次。" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "签发失败。请确认已执行数据库 schema，并检查服务端 Supabase 配置。" }, { status: 500 });
  }
}
