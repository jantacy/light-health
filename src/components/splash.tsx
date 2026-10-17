"use client";

import { useEffect, useState } from "react";
import { fallbackQuote, quoteFits } from "@/lib/quote-pool";
import { todayISO } from "@/lib/date";

const KEY = "light-meal:quotes";

function readQuotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

// 本机保存未来 10 天的箴言；每次启动后台刷新一次，离线时用已缓存或内置的句子。
export function refreshQuotes(): Promise<void> {
  return fetch("/api/quotes").then((r) => r.json()).then(({ quotes }: { quotes: { date: string; text: string }[] }) => {
    const today = todayISO();
    const merged = { ...readQuotes() };
    for (const q of quotes) if (!merged[q.date]) merged[q.date] = q.text;
    const kept = Object.fromEntries(Object.entries(merged).filter(([d]) => d >= today).sort().slice(0, 10));
    try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch {}
  }).catch(() => {});
}

export function todayQuote() {
  const today = todayISO();
  const cached = readQuotes()[today];
  return cached && quoteFits(cached) ? cached : fallbackQuote(today); // 旧规则生成的长句不再显示
}

export default function Splash() {
  const [quote, setQuote] = useState("");
  useEffect(() => setQuote(todayQuote()), []);
  return <main className="splash" aria-busy="true">
    <div className="splash-brand"><img className="brand-mark" src="/icon.svg" alt=""/><strong>轻食记</strong></div>
    <p className="splash-quote">{quote}</p>
    <span className="splash-dot"/>
  </main>;
}
