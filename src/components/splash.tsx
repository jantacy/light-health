"use client";

import { useEffect, useState } from "react";
import { quoteForDate } from "@/lib/quote-pool";
import { todayISO } from "@/lib/date";
import BrandIcon from "./brand-icon";

// 每日箴言由日期直接算出（见 quote-pool.ts），不用联网。
export function todayQuote() {
  try { localStorage.removeItem("light-meal:quotes"); } catch {} // 旧版本缓存的模型生成句子
  return quoteForDate(todayISO());
}

export default function Splash() {
  const [quote, setQuote] = useState("");
  useEffect(() => setQuote(todayQuote()), []);
  return <main className="splash" aria-busy="true">
    <div className="splash-brand"><BrandIcon/><strong>轻食记</strong></div>
    <p className="splash-quote">{quote}</p>
    <span className="splash-dot"/>
  </main>;
}
