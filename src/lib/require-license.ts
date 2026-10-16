import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// 校验 Bearer 令牌对应的用户登录有效且 License 仍为 active；通过返回 null，否则返回错误响应。
export async function requireLicense(request: Request): Promise<NextResponse | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ error: "登录服务尚未配置。" }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  try {
    const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ error: "登录状态已失效，请重新登录。" }, { status: 401 });
    const { data: license, error: licenseError } = await createAdminClient().from("user_licenses").select("id").eq("user_id", data.user.id).eq("status", "active").maybeSingle();
    if (licenseError) throw licenseError;
    if (!license) return NextResponse.json({ error: "账号授权已失效，请联系管理员。" }, { status: 403 });
    return null;
  } catch {
    return NextResponse.json({ error: "暂时无法验证账号授权，请稍后重试。" }, { status: 503 });
  }
}
