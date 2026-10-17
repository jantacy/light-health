import { NextResponse } from "next/server";
import { quoteForDate } from "@/lib/quote-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 未来 10 天的每日箴言。新版前端直接按日期计算，不再请求这里；保留给还没更新的旧版本。
const shanghaiDate = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

export async function GET() {
  const quotes = Array.from({ length: 10 }, (_, i) => { const date = shanghaiDate(i); return { date, text: quoteForDate(date) }; });
  return NextResponse.json({ quotes }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
