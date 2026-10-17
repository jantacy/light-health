"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronRight } from "lucide-react";
import { addDays, todayISO, shortDate, weekdayDate } from "@/lib/date";
import { round1 } from "@/lib/number";
import { readTrendStore, syncTrends } from "@/lib/trend-store";

// version：本地趋势数据被首页下拉刷新更新后变化，趋势页重新读取。
type Props = { supabase: SupabaseClient; userId: string; goal: number; targetWeight: number | null; version: number; onPickDay: (date: string) => void };
const ranges = [7, 30, 90] as const;

export default function Trends({ supabase, userId, goal, targetWeight, version, onPickDay }: Props) {
  const [range, setRange] = useState<(typeof ranges)[number]>(7);
  const [store, setStore] = useState(() => readTrendStore(userId));
  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDays(todayISO(), i - range + 1)), [range]);

  // 先画本地数据；本地覆盖不到这个范围时才会真正请求服务端。
  useEffect(() => {
    setStore(readTrendStore(userId));
    syncTrends(supabase, userId, range).then((next) => { if (next) setStore(next); });
  }, [supabase, userId, range, version]);

  const logged = days.filter((d) => store.days[d]);
  const avg = (key: "calories" | "protein") => logged.length ? Math.round(logged.reduce((s, d) => s + store.days[d][key], 0) / logged.length) : 0;
  const weightDays = days.filter((d) => store.weights[d] !== undefined);
  const delta = weightDays.length > 1 ? round1(store.weights[weightDays[weightDays.length - 1]] - store.weights[weightDays[0]]) : null;

  return <div className="trends">
    <div className="segmented range-switch">{ranges.map((n) => <button key={n} className={range === n ? "active" : ""} onClick={() => setRange(n)}>{n} 天</button>)}</div>
    <section className="section"><div className="section-heading"><div><span className="eyebrow">CALORIE TREND</span><h2>热量趋势</h2></div></div>
      <LineChart points={days.map((d) => ({ date: d, value: store.days[d]?.calories ?? null }))} unit="kcal" goal={goal} fromZero onPickDay={onPickDay}/>
      <div className="trend-stats"><div><small>记录天数</small><strong>{logged.length}<span>/{range}</span></strong></div><div><small>日均热量</small><strong>{avg("calories")}<span>kcal</span></strong></div><div><small>日均蛋白质</small><strong>{avg("protein")}<span>g</span></strong></div></div>
      <p className="weight-hint">没有记录的日子不计入日均。点图上的某一天可查看明细。</p>
    </section>
    <section className="section"><div className="section-heading"><div><span className="eyebrow">WEIGHT TREND</span><h2>体重变化</h2></div>{delta !== null && <div className="weight-current"><strong>{delta > 0 ? `+${delta}` : delta}</strong><small>kg</small></div>}</div>
      {weightDays.length > 1 ? <LineChart points={days.map((d) => ({ date: d, value: store.weights[d] ?? null }))} unit="kg" goal={targetWeight ?? undefined} onPickDay={onPickDay}/> : <p className="weight-hint">这段时间记录两次以上体重后显示曲线。</p>}
    </section>
  </div>;
}

type Point = { date: string; value: number | null };

// fromZero：热量从 0 起画，超过目标的点标色。否则（体重）按实际范围上下留白，范围包含目标线。
function LineChart({ points, unit, goal, fromZero, onPickDay }: { points: Point[]; unit: string; goal?: number; fromZero?: boolean; onPickDay: (date: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const span = goal !== undefined ? [...values, goal] : values;
  const lo = fromZero ? 0 : Math.min(...span) - 1;
  const hi = fromZero ? Math.max((goal ?? 0) * 1.2, ...values) : Math.max(...span) + 1;
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
      {goal !== undefined && <i className="goal-line" style={{ top: `${y(goal)}%` }}><span>目标 {round1(goal)}</span></i>}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={path} vectorEffect="non-scaling-stroke"/></svg>
      {coords.map((c) => <i key={c.i} className={`dot${active === c.i ? " active" : ""}${fromZero && goal !== undefined && points[c.i].value! > goal ? " over" : ""}`} style={{ left: `${c.x}%`, top: `${c.y}%` }}/>)}
      {active !== null && <i className="cursor" style={{ left: `${x(active)}%` }}/>}
      <div className="hit-areas">{points.map((p, i) => <button key={p.date} aria-label={p.date} onClick={() => setActive(i)}/>)}</div>
    </div>
    <div className="line-chart-axis">{labels.map((i, k) => <span key={k} style={{ left: `${x(i)}%` }}>{shortDate(points[i].date)}</span>)}</div>
  </div>;
}
