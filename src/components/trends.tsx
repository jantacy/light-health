"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dayRange, localDay, shortDate, todayISO } from "@/lib/date";
import type { Meal, WeightEntry } from "@/lib/types";

type DayRow = Pick<Meal, "eaten_at" | "calories" | "protein_g" | "carbs_g" | "fat_g">;
type Props = { supabase: SupabaseClient; goal: number; refreshKey: number; onPickDay: (date: string) => void };

export default function Trends({ supabase, goal, refreshKey, onPickDay }: Props) {
  const [range, setRange] = useState<7 | 30>(7);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDays(todayISO(), i - range + 1)), [range]);

  useEffect(() => {
    setLoading(true);
    const { start } = dayRange(days[0]);
    const { end } = dayRange(days[days.length - 1]);
    Promise.all([
      supabase.from("meal_records").select("eaten_at, calories, protein_g, carbs_g, fat_g").gte("eaten_at", start).lt("eaten_at", end),
      supabase.from("weight_records").select("*").gte("recorded_on", days[0]).order("recorded_on")
    ]).then(([m, w]) => { setRows((m.data || []) as DayRow[]); setWeights((w.data || []) as WeightEntry[]); setLoading(false); });
  }, [supabase, days, refreshKey]);

  const byDay = useMemo(() => {
    const map = new Map(days.map((d) => [d, { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 }]));
    for (const r of rows) {
      const day = map.get(localDay(r.eaten_at));
      if (!day) continue;
      day.calories += Number(r.calories); day.protein += Number(r.protein_g); day.carbs += Number(r.carbs_g); day.fat += Number(r.fat_g); day.count++;
    }
    return map;
  }, [rows, days]);

  const logged = [...byDay.values()].filter((d) => d.count > 0);
  const avg = (key: "calories" | "protein" | "carbs" | "fat") => logged.length ? Math.round(logged.reduce((s, d) => s + d[key], 0) / logged.length) : 0;
  const max = Math.max(goal, ...[...byDay.values()].map((d) => d.calories));

  return <div className="trends">
    <section className="section"><div className="section-heading"><div><span className="eyebrow">CALORIE TREND</span><h2>热量趋势</h2></div><div className="segmented">{([7, 30] as const).map((n) => <button key={n} className={range === n ? "active" : ""} onClick={() => setRange(n)}>{n} 天</button>)}</div></div>
      <div className={`calorie-chart ${range === 30 ? "dense" : ""}`} aria-busy={loading}>
        <i className="goal-line" style={{ bottom: `${goal / max * 100}%` }}><span>目标 {goal}</span></i>
        {days.map((d) => { const v = byDay.get(d)!; return <button key={d} title={`${shortDate(d)} ${Math.round(v.calories)} kcal`} onClick={() => onPickDay(d)}><i className={v.calories > goal ? "over" : ""} style={{ height: `${v.calories / max * 100}%` }}/><small>{range === 7 || d.endsWith("01") || d === days[0] ? shortDate(d) : ""}</small></button>; })}
      </div>
      <div className="trend-stats"><div><small>记录天数</small><strong>{logged.length}<span>/{range}</span></strong></div><div><small>日均热量</small><strong>{avg("calories")}<span>kcal</span></strong></div><div><small>日均蛋白质</small><strong>{avg("protein")}<span>g</span></strong></div></div>
      <p className="weight-hint">日均只统计有记录的日子。点柱子可查看当天明细。</p>
    </section>
    <section className="section"><div className="section-heading"><div><span className="eyebrow">WEIGHT TREND</span><h2>体重变化</h2></div>{weights.length > 1 && <WeightDelta weights={weights}/>}</div>
      {weights.length > 1 ? <WeightChart weights={weights}/> : <p className="weight-hint">记录两次以上体重后显示变化曲线。</p>}
    </section>
  </div>;
}

function WeightDelta({ weights }: { weights: WeightEntry[] }) {
  const delta = Math.round((weights[weights.length - 1].weight_kg - weights[0].weight_kg) * 10) / 10;
  return <div className="weight-current"><strong>{delta > 0 ? `+${delta}` : delta}</strong><small>kg</small></div>;
}

function WeightChart({ weights }: { weights: WeightEntry[] }) {
  const values = weights.map((w) => Number(w.weight_kg));
  const lo = Math.min(...values) - 0.5, hi = Math.max(...values) + 0.5;
  const t0 = new Date(weights[0].recorded_on).getTime(), t1 = new Date(weights[weights.length - 1].recorded_on).getTime();
  const pts = weights.map((w, i) => [((new Date(w.recorded_on).getTime() - t0) / Math.max(1, t1 - t0)) * 300, 100 - ((values[i] - lo) / (hi - lo)) * 100]);
  return <div className="weight-chart">
    <svg viewBox="-8 -8 316 116" preserveAspectRatio="none" role="img" aria-label="体重变化曲线"><polyline vectorEffect="non-scaling-stroke" points={pts.map((p) => p.join(",")).join(" ")}/></svg>
    <div className="weight-axis"><span>{shortDate(weights[0].recorded_on)} · {values[0]}kg</span><span>{shortDate(weights[weights.length - 1].recorded_on)} · {values[values.length - 1]}kg</span></div>
  </div>;
}
