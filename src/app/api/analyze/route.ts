import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireLicense } from "@/lib/require-license";
import { getVisionProvider, VisionError, type FoodAnalysis } from "@/lib/vision";
import { fromPer100, lookupFoods, normName, saveFoods } from "@/lib/food-library";

export const runtime = "nodejs";
export const maxDuration = 60;

// 前端已把照片（含 iPhone HEIC）缩到 1600px 并转成 JPEG，这里只按文件头确认确实是图片。
function imageMime(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// 同一张照片（按内容哈希）重复识别时直接用上次的模型结果，不再调用 API。进程内保存最近 200 张。
const recent = new Map<string, FoodAnalysis>();
function remember(hash: string, analysis: FoodAnalysis) {
  recent.set(hash, structuredClone(analysis));
  if (recent.size > 200) recent.delete(recent.keys().next().value!);
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
    const hash = createHash("sha256").update(bytes).digest("hex");
    const cached = recent.get(hash);
    const analysis = cached ? structuredClone(cached) : await provider.analyze({ image: bytes, mime });
    if (!cached && analysis.items.length) remember(hash, analysis);
    // 库里已有的食物按库里的单位营养重算（同一种食物前后一致）；新的食物入库。
    const library = await lookupFoods(analysis.items.map((i) => i.name));
    const fresh: Parameters<typeof saveFoods>[0] = [];
    analysis.items = analysis.items.map((i) => {
      const row = library.get(normName(i.name));
      if (row && i.grams > 0) return { ...i, ...fromPer100(row, i.grams) };
      fresh.push({ name: i.name, grams: i.grams, n: i });
      return i;
    });
    if (analysis.items.length) {
      const t = analysis.items.reduce((a, i) => ({ calories: a.calories + i.calories, protein_g: a.protein_g + i.protein_g, carbs_g: a.carbs_g + i.carbs_g, fat_g: a.fat_g + i.fat_g }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      Object.assign(analysis, t);
    }
    await saveFoods(fresh, "photo");
    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof VisionError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[analyze]", err);
    return NextResponse.json({ error: "识图连接暂时失败，请稍后重试或手动填写。" }, { status: 503 });
  }
}
