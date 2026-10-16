import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { requireLicense } from "@/lib/require-license";
import { getVisionProvider, VisionError } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 60;

// 前端已把照片（含 iPhone HEIC）缩到 1600px 并转成 JPEG，这里只按文件头确认确实是图片。
function imageMime(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  const provider = getVisionProvider();
  if (!provider) return NextResponse.json({ error: "识图服务尚未配置，请在服务端填写 VISION_API_KEY。" }, { status: 503 });
  const denied = await requireLicense(request);
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File)) return NextResponse.json({ error: "请先选择一张照片。" }, { status: 400 });
  if (image.size > 4 * 1024 * 1024) return NextResponse.json({ error: "图片不能超过 4 MB。" }, { status: 413 });
  const bytes = Buffer.from(await image.arrayBuffer());
  const mime = imageMime(bytes);
  if (!mime) return NextResponse.json({ error: "识图支持 JPG、PNG、WebP 照片。" }, { status: 415 });

  try {
    const analysis = await provider.analyze({ image: bytes, mime });
    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof VisionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[analyze]", err);
    return NextResponse.json({ error: "识图连接暂时失败，请稍后重试或手动填写。" }, { status: 503 });
  }
}
