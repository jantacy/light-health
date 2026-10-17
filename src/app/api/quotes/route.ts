import { NextResponse } from "next/server";
import { fallbackQuote, quoteFits } from "@/lib/quote-pool";
import { getModelConfig } from "@/lib/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 未来 10 天的每日箴言。公开的语录接口没有“积极健康”分类、内容跑题，所以由模型按主题和长度要求生成，
// 每个进程每天最多调用一次；生成失败或不合格的用内置列表补上（不缓存，下次再试）。
const DAYS = 10;
const negative = /死|亡|恨|泪|哭|痛|孤独|寂寞|绝望|悲|伤心|杀|血|醉|愁|kill|death|die|hate|cry|pain|war|sad|lonely|fear/i;
const cache = new Map<string, string>();
let pending: Promise<void> | null = null;

const shanghaiDate = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

function acceptable(text: string) {
  return !!text && !negative.test(text) && quoteFits(text);
}

async function generate(dates: string[]) {
  const config = getModelConfig();
  if (!config) return;
  const recent = [...cache.values()].slice(-10);
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: config.model,
      temperature: 1.1,
      max_tokens: 3000, // 模型会先推理，推理 token 也计入上限
      messages: [{
        role: "user",
        content: `写 ${dates.length} 句积极、健康、向上的短句，用在饮食记录 App 的启动页，不需要是名人名言。要求：温和自然，主题覆盖好好吃饭、运动、睡眠、心态；中文和英文大致各一半；中文不超过 14 个字（含标点），英文不超过 26 个字母（含空格，约 5 个词）；不要署名和出处，不要说教，彼此不重复${recent.length ? `，也不要和这些重复：${recent.join(" / ")}` : ""}。只返回 JSON 字符串数组。`
      }]
    })
  });
  if (!response.ok) return;
  const content: string = (await response.json())?.choices?.[0]?.message?.content ?? "";
  if (!content.includes("[")) return;
  const list = JSON.parse(content.slice(content.indexOf("["), content.lastIndexOf("]") + 1));
  const good = (Array.isArray(list) ? list : []).filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(acceptable);
  dates.forEach((date, i) => { if (good[i]) cache.set(date, good[i]); });
}

export async function GET() {
  const dates = Array.from({ length: DAYS }, (_, i) => shanghaiDate(i));
  for (const key of cache.keys()) if (key < dates[0]) cache.delete(key);
  const missing = dates.filter((d) => !cache.has(d));
  if (missing.length) {
    pending ??= generate(missing).catch((err) => console.error("[quotes]", err)).finally(() => { pending = null; });
    await pending;
  }
  const quotes = dates.map((date) => ({ date, text: cache.get(date) ?? fallbackQuote(date) }));
  return NextResponse.json({ quotes }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
