import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVisionProvider, VisionError } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 30;

// 前端已把照片（含 iPhone HEIC）缩到 1600px 并转成 JPEG，这里只按文件头确认确实是图片。
function imageMime(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  const provider = getVisionProvider();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!provider) return NextResponse.json({ error: "识图服务尚未配置，请在服务端填写 VISION_API_KEY。" }, { status: 503 });
  if (!url || !anonKey) return NextResponse.json({ error: "登录服务尚未配置。" }, { status: 503 });

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return NextResponse.json({ error: "请先登录后再使用识图。" }, { status: 401 });

  try {
    const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ error: "登录状态已失效，请重新登录。" }, { status: 401 });

    const admin = createAdminClient();
    const { data: license, error: licenseError } = await admin.from("user_licenses").select("id").eq("user_id", data.user.id).eq("status", "active").maybeSingle();
    if (licenseError) throw licenseError;
    if (!license) return NextResponse.json({ error: "账号授权已失效，请联系管理员。" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "暂时无法验证账号授权，请稍后重试。" }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File)) return NextResponse.json({ error: "请先选择一张照片。" }, { status: 400 });
  if (image.size > 4 * 1024 * 1024) return NextResponse.json({ error: "图片不能超过 4 MB。" }, { status: 413 });
  const bytes = Buffer.from(await image.arrayBuffer());
  const mime = imageMime(bytes);
  if (!mime) return NextResponse.json({ error: "识图支持 JPG、PNG、WebP 照片。" }, { status: 415 });

  try {
    const analysis = await provider.analyze(bytes, mime);
    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof VisionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[analyze]", err);
    return NextResponse.json({ error: "识图连接暂时失败，请稍后重试或手动填写。" }, { status: 502 });
  }
}
