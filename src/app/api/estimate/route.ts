import { NextResponse } from "next/server";
import { requireLicense } from "@/lib/require-license";
import { getVisionProvider, VisionError } from "@/lib/vision";

export const runtime = "nodejs";

// 按食物名称 + 重量估算营养：只调用语言模型（不发图片、关闭推理），通常 1~3 秒。
export async function POST(request: Request) {
  const provider = getVisionProvider();
  if (!provider) return NextResponse.json({ error: "AI 估算尚未配置。" }, { status: 503 });
  const denied = await requireLicense(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const grams = Number(body?.grams) > 0 ? Math.min(Math.round(Number(body.grams)), 5000) : 0;
  if (!name) return NextResponse.json({ error: "请填写食物名称。" }, { status: 400 });

  try {
    const a = await provider.analyze({ hint: grams ? `${name}，${grams}克` : name });
    return NextResponse.json(
      { calories: a.calories, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g, grams: grams || a.items[0]?.grams || 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof VisionError) return NextResponse.json({ error: err.message.replace("识图", "AI 估算") }, { status: err.status });
    console.error("[estimate]", err);
    return NextResponse.json({ error: "AI 估算暂时失败，请稍后重试。" }, { status: 503 });
  }
}
