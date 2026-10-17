"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronRight } from "lucide-react";
import { addDays, dayRange, localDay, shortDate, todayISO, weekdayDate } from "@/lib/date";
import type { Meal, WeightEntry } from "@/lib/types";
import { round1 } from "@/lib/number";

type DayRow = Pick<Meal, "eaten_at" | "calories" | "protein_g">;
type Props = { supabase: SupabaseClient; goal: number; refreshKey: number; onPickDay: (date: string) => void };
const ranges = [7, 30, 90] as const;

export default function Trends({ supabase, goal, refreshKey, onPickDay }: Props) {
  const [range, setRange] = useState<(typeof ranges)[number]>(7);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDays(todayISO(), i - range + 1)), [range]);

  useEffect(() => {
    const { start } = dayRange(days[0]);
    const { end } = dayRange(days[days.length - 1]);
    Promise.all([
      supabase.from("meal_records").select("eaten_at, calories, protein_g").gte("eaten_at", start).lt("eaten_at", end),
      supabase.from("weight_records").select("*").gte("recorded_on", days[0]).order("recorded_on")
    ]).then(([m, w]) => { setRows((m.data || []) as DayRow[]); setWeights((w.data || []) as WeightEntry[]); });
  }, [supabase, days, refreshKey]);

  const byDay = useMemo(() => {
    const map = new Map<string, { calories: number; protein: number }>();
    for (const r of rows) {
      const d = localDay(r.eaten_at);
      const v = map.get(d) ?? { calories: 0, protein: 0 };
      v.calories += Number(r.calories); v.protein += Number(r.protein_g);
      map.set(d, v);
    }
    return map;
  }, [rows]);

  const logged = days.filter((d) => byDay.has(d));
  const avg = (key: "calories" | "protein") => logged.length ? Math.round(logged.reduce((s, d) => s + byDay.get(d)![key], 0) / logged.length) : 0;
  const weightByDay = new Map(weights.map((w) => [w.recorded_on, Number(w.weight_kg)]));
  const firstW = weights[0], lastW = weights[weights.length - 1];
  const delta = weights.length > 1 ? round1(Number(lastW.weight_kg) - Number(firstW.weight_kg)) : null;

  return <div className="trends">
    <div className="segmented range-switch">{ranges.map((n) => <button key={n} className={range === n ? "active" : ""} onClick={() => setRange(n)}>{n} 天</button>)}</div>
    <section className="section"><div className="section-heading"><div><span className="eyebrow">CALORIE TREND</span><h2>热量趋势</h2></div></div>
      <LineChart points={days.map((d) => ({ date: d, value: byDay.get(d)?.calories ?? null }))} unit="kcal" goal={goal} onPickDay={onPickDay}/>
      <div className="trend-stats"><div><small>记录天数</small><strong>{logged.length}<span>/{range}</span></strong></div><div><small>日均热量</small><strong>{avg("calories")}<span>kcal</span></strong></div><div><small>日均蛋白质</small><strong>{avg("protein")}<span>g</span></strong></div></div>
      <p className="weight-hint">没有记录的日子不计入日均。点图上的某一天可查看明细。</p>
    </section>
    <section className="section"><div className="section-heading"><div><span className="eyebrow">WEIGHT TREND</span><h2>体重变化</h2></div>{delta !== null && <div className="weight-current"><strong>{delta > 0 ? `+${delta}` : delta}</strong><small>kg</small></div>}</div>
      {weights.length > 1 ? <LineChart points={days.map((d) => ({ date: d, value: weightByDay.get(d) ?? null }))} unit="kg" onPickDay={onPickDay}/> : <p className="weight-hint">这段时间记录两次以上体重后显示曲线。</p>}
    </section>
  </div>;
}

type Point = { date: string; value: number | null };

function LineChart({ points, unit, goal, onPickDay }: { points: Point[]; unit: string; goal?: number; onPickDay: (date: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  // 热量从 0 起画并给目标线留空间；体重按实际范围上下留白。
  const lo = goal !== undefined ? 0 : Math.min(...values) - 1;
  const hi = goal !== undefined ? Math.max(goal * 1.2, ...values) : Math.max(...values) + 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - ((v - lo) / (hi - lo || 1)) * 100;
  const coords = points.flatMap((p, i) => (p.value === null ? [] : [{ i, x: x(i), y: y(p.value) }]));
  const path = coords.map((c, k) => `${k ? "L" : "M"}${c.x},${c.y}`).join(" ");
  const labels = [0, Math.floor((n - 1) / 2), n - 1];
  const sel = active !== null ? points[active] : null;

  return <div className="line-chart">
    <div className="line-chart-info">{sel ? <><span>{weekdayDate(sel.date)}</span><strong>{sel.value === null ? "无记录" : `${round1(sel.value)} ${unit}`}</strong><button onClick={() => onPickDay(sel.date)}>查看这天 <ChevronRight size={13}/></button></> : <span>点图表查看某一天</span>}</div>
    <div className="line-chart-plot">
      {goal !== undefined && <i className="goal-line" style={{ top: `${y(goal)}%` }}><span>目标 {goal}</span></i>}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={path} vectorEffect="non-scaling-stroke"/></svg>
      {coords.map((c) => <i key={c.i} className={`dot${active === c.i ? " active" : ""}${goal !== undefined && points[c.i].value! > goal ? " over" : ""}`} style={{ left: `${c.x}%`, top: `${c.y}%` }}/>)}
      {active !== null && <i className="cursor" style={{ left: `${x(active)}%` }}/>}
      <div className="hit-areas">{points.map((p, i) => <button key={p.date} aria-label={p.date} onClick={() => setActive(i)}/>)}</div>
    </div>
    <div className="line-chart-axis">{labels.map((i, k) => <span key={k} style={{ left: `${x(i)}%` }}>{shortDate(points[i].date)}</span>)}</div>
  </div>;
}
