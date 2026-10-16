import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  const license = typeof body?.license === "string" ? body.license.trim() : "";
  if (!phone || !/^FOOD-[A-Za-z0-9_-]{32}$/.test(license)) return NextResponse.json({ error: "手机号或 License 无效。" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ error: "登录服务尚未配置。" }, { status: 503 });

  try {
    const admin = createAdminClient();
    const license_hash = createHash("sha256").update(license).digest("hex");
    const { data: entry, error } = await admin.from("user_licenses").select("id, phone, user_id").eq("phone", phone).eq("license_hash", license_hash).eq("status", "active").maybeSingle();
    if (error) throw error;
    if (!entry) return NextResponse.json({ error: "手机号与 License 不匹配，或 License 已失效。" }, { status: 401 });

    const emailId = createHash("sha256").update(entry.phone).digest("hex");
    const email = `license-${emailId}@foodlog.invalid`;
    let userId = entry.user_id as string | null;
    if (!userId) {
      const { data, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true, password: license, app_metadata: { auth_method: "server_license" } });
      if (createError) throw createError;
      userId = data.user.id;
      const { error: linkError } = await admin.from("user_licenses").update({ user_id: userId, updated_at: new Date().toISOString() }).eq("id", entry.id);
      if (linkError) throw linkError;
    }

    // 资料行按手机号关联到账号；已有的昵称等字段不受影响。
    const { error: profileError } = await admin.from("user_profiles").upsert({ phone: entry.phone, user_id: userId }, { onConflict: "phone" });
    if (profileError) throw profileError;

    // 登录时不改密码：Supabase 改密码会注销该账号的所有其他会话（另一台设备会被踢下线）。
    // 内部密码只在创建账号和重新签发 License 时设置；对不上时（旧版本遗留、曾被封禁）才同步一次。
    const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    let { data, error: signInError } = await auth.auth.signInWithPassword({ email, password: license });
    if (signInError || !data.session) {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: license, ban_duration: "none" });
      if (updateError) throw updateError;
      ({ data, error: signInError } = await auth.auth.signInWithPassword({ email, password: license }));
    }
    if (signInError || !data.session) throw signInError || new Error("Session was not created.");
    return NextResponse.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "登录暂不可用，请稍后再试或联系管理员。" }, { status: 500 });
  }
}
