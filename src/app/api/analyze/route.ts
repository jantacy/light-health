import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey) return NextResponse.json({ error: "DeepSeek 识图尚未配置，请在服务端填写 DEEPSEEK_API_KEY。" }, { status: 503 });
  if (!url || !anonKey) return NextResponse.json({ error: "登录服务尚未配置。" }, { status: 503 });

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return NextResponse.json({ error: "请先登录后再使用识图。" }, { status: 401 });

  let userId: string;
  try {
    const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ error: "登录状态已失效，请重新登录。" }, { status: 401 });
    userId = data.user.id;

    const admin = createAdminClient();
    const { data: license, error: licenseError } = await admin.from("user_licenses").select("id").eq("user_id", userId).eq("status", "active").maybeSingle();
    if (licenseError) throw licenseError;
    if (!license) return NextResponse.json({ error: "账号授权已失效，请联系管理员。" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "暂时无法验证账号授权，请稍后重试。" }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File)) return NextResponse.json({ error: "请先选择一张照片。" }, { status: 400 });
  if (!supportedTypes.has(image.type)) return NextResponse.json({ error: "识图支持 JPG、PNG、WebP、GIF 和 iPhone HEIC 照片。" }, { status: 415 });
  if (image.size > 10 * 1024 * 1024) return NextResponse.json({ error: "图片不能超过 10 MB。" }, { status: 413 });

  try {
    const input = Buffer.from(await image.arrayBuffer());
    const jpeg = await sharp(input, { animated: false, failOn: "error" })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
    const base64 = jpeg.toString("base64");
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: "deepseek-flash",
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: "json_object" },
        user_id: userId,
        messages: [
          {
            role: "system",
            content: "你是饮食记录助手。只根据照片估算可见食物和一人份的总营养，不要给医疗建议。对份量和烹饪用油做合理估算；照片无法判断的成分不要假装精确。请仅返回有效 json 对象，字段必须是 title（简短中文菜名）、calories（总热量 kcal 数字）、protein_g（蛋白质克数数字）、carbs_g（碳水克数数字）、fat_g（脂肪克数数字）。示例：{\"title\":\"鸡肉蔬菜饭\",\"calories\":520,\"protein_g\":32,\"carbs_g\":58,\"fat_g\":16}"
          },
          {
            role: "user",
            content: [
              { type: "text", text: "识别这张饮食照片，并按要求估算整份餐食的营养。" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "auto" } }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const status = response.status;
      return NextResponse.json({ error: status === 429 ? "识图服务繁忙，请稍后重试。" : "暂时无法完成识图，请稍后重试或手动填写。" }, { status: status === 429 ? 503 : 502 });
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "识图结果为空，请重试或手动填写。" }, { status: 502 });
    const result = JSON.parse(content);
    const calories = numberValue(result.calories);
    const protein_g = numberValue(result.protein_g);
    const carbs_g = numberValue(result.carbs_g);
    const fat_g = numberValue(result.fat_g);
    if (typeof result.title !== "string" || calories === null || protein_g === null || carbs_g === null || fat_g === null) {
      return NextResponse.json({ error: "识图返回的数据格式不完整，请重试或手动填写。" }, { status: 502 });
    }
    return NextResponse.json({ title: result.title.trim().slice(0, 160), calories, protein_g, carbs_g, fat_g }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "识图连接暂时失败，请稍后重试或手动填写。" }, { status: 502 });
  }
}
