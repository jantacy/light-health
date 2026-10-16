"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Camera, ChevronLeft, ChevronRight, Flame, Leaf, LogOut, Plus, Scale, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { addDays, dayRange, localDay, shortDate, todayISO } from "@/lib/date";
import type { Meal, WeightEntry } from "@/lib/types";
import MealModal, { mealLabels } from "./meal-modal";
import Trends from "./trends";

const GOAL = 2000;

export default function Home() {
  const [supabase] = useState(createClient);
  const [session, setSession] = useState<any>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [licenseInput, setLicenseInput] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [tab, setTab] = useState<"day" | "trends">("day");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [editing, setEditing] = useState<Meal | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestedPhotos = useRef(new Set<string>());
  const date = selectedDate;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) return;
    const { start, end } = dayRange(date);
    Promise.all([
      supabase.from("meal_records").select("*").gte("eaten_at", start).lt("eaten_at", end).order("eaten_at"),
      supabase.from("weight_records").select("*").lte("recorded_on", date).order("recorded_on", { ascending: false }).limit(7)
    ]).then(([m, w]) => { setMeals((m.data || []) as Meal[]); setWeights((w.data || []) as WeightEntry[]); });
  }, [session, date, supabase, refreshKey]);

  // 私有 bucket 的照片用短期签名 URL 展示。
  useEffect(() => {
    const paths = meals.map((m) => m.image_path).filter((p): p is string => !!p && !requestedPhotos.current.has(p));
    if (!paths.length) return;
    paths.forEach((p) => requestedPhotos.current.add(p));
    supabase.storage.from("meal-photos").createSignedUrls(paths, 3600).then(({ data }) => {
      if (data) setPhotoUrls((urls) => ({ ...urls, ...Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string])) }));
    });
  }, [meals, supabase]);

  const totals = useMemo(() => meals.reduce((a, m) => ({ calories: a.calories + Number(m.calories), protein: a.protein + Number(m.protein_g), carbs: a.carbs + Number(m.carbs_g), fat: a.fat + Number(m.fat_g) }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [meals]);
  const currentWeight = weights[0]?.weight_kg;
  const dateObject = new Date(`${date}T12:00:00`);
  const greetingDate = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(dateObject);
  const isToday = date === todayISO();
  function shiftDate(delta: number) {
    const next = addDays(date, delta);
    if (next <= todayISO()) setSelectedDate(next);
  }

  async function signInWithLicense(e: React.FormEvent) {
    e.preventDefault(); setLoggingIn(true); setAuthMessage("正在验证 License…");
    try {
      const response = await fetch("/api/auth/license", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phoneInput.trim(), license: licenseInput.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "License 无效");
      const { error } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
      if (error) throw error;
      setAuthMessage("登录成功，正在进入…");
    } catch (err) { setAuthMessage(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoggingIn(false); }
  }

  function mealSaved(saved: Meal) {
    if (localDay(saved.eaten_at) === date) setMeals((items) => (items.some((m) => m.id === saved.id) ? items.map((m) => (m.id === saved.id ? saved : m)) : [...items, saved]).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at)));
    setEditing(null); setRefreshKey((k) => k + 1); setNotice("已保存这条饮食记录");
  }

  function mealDeleted(id: string) {
    setMeals((items) => items.filter((m) => m.id !== id));
    setEditing(null); setRefreshKey((k) => k + 1); setNotice("已删除");
  }

  async function saveWeight(e: React.FormEvent) {
    e.preventDefault(); const value = Number(weightInput); if (!value || !session) return;
    const { data, error } = await supabase.from("weight_records").upsert({ user_id: session.user.id, recorded_on: date, weight_kg: value }, { onConflict: "user_id,recorded_on" }).select().single();
    if (error) setNotice("体重保存失败，请检查 Supabase 配置。"); else { setWeights((rows) => [data as WeightEntry, ...rows.filter((r) => r.recorded_on !== date)].slice(0, 7)); setWeightInput(""); setRefreshKey((k) => k + 1); setNotice("体重已记录"); }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><Leaf size={23}/></div><span className="eyebrow">PRIVATE FOOD JOURNAL</span><h1>轻食记</h1><p>请先配置 Supabase 项目，完成后即可开始登录和记录。</p><code>复制 .env.example 为 .env.local 并填入 Supabase URL 与 anon key</code></div></main>;

  if (!session) return <main className="auth-screen"><div className="auth-card"><div className="brand-mark"><Leaf size={24}/></div><span className="eyebrow">PRIVATE FOOD JOURNAL</span><h1>好好吃饭，<br/>慢慢记录。</h1><p className="auth-copy">输入受邀手机号和对应的专属 License，打开你的私人饮食记录空间。</p><form onSubmit={signInWithLicense} className="auth-form"><label htmlFor="login-phone">手机号</label><input id="login-phone" type="tel" autoComplete="tel" required placeholder="13800000000" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}/><label htmlFor="license">License</label><input id="license" type="password" autoComplete="current-password" required placeholder="输入你收到的 License" value={licenseInput} onChange={(e) => setLicenseInput(e.target.value)}/><button className="primary-button" type="submit" disabled={loggingIn}>{loggingIn ? "正在验证…" : "登录"} <ChevronRight size={18}/></button></form>{authMessage && <p className="form-message">{authMessage}</p>}<p className="tiny-note">手机号与 License 必须匹配</p></div><div className="auth-decoration"><span>01</span><i/><span>照顾身体，从一餐开始</span></div></main>;

  return <main className="app-shell">
    <header className="topbar"><a className="wordmark" href="#top"><span className="brand-mark small"><Leaf size={17}/></span>轻食记</a><div className="user-menu"><span>已授权用户</span><button title="退出登录" onClick={() => supabase.auth.signOut()}><LogOut size={17}/></button></div></header>
    <div className="dashboard" id="top">
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {tab === "trends" ? <Trends supabase={supabase} goal={GOAL} refreshKey={refreshKey} onPickDay={(d) => { setSelectedDate(d); setTab("day"); }}/> : <>
      <section className="welcome"><div><span className="eyebrow">{greetingDate}</span><h1>{isToday ? "今天也要，" : "那天也要，"}<em>好好吃饭。</em></h1><p>记录每一餐，照顾好自己的节奏。</p></div><div className="date-pill"><button aria-label="查看前一天" onClick={() => shiftDate(-1)}><ChevronLeft size={15}/></button><span className="date-dot"/> {isToday ? "今天" : shortDate(date)}<button aria-label="查看后一天" onClick={() => shiftDate(1)} disabled={isToday}><ChevronRight size={15}/></button></div></section>
      <section className="summary-card"><div className="summary-head"><div><span className="eyebrow light">{isToday ? "TODAY’S INTAKE" : "DAILY INTAKE"}</span><h2>{isToday ? "今日摄入" : `${shortDate(date)} 摄入`}</h2></div><span className="flame-icon"><Flame size={19}/></span></div><div className="calorie-line"><strong>{Math.round(totals.calories).toLocaleString()}</strong><span>kcal</span><small>/ {GOAL.toLocaleString()}</small></div><div className="progress"><i style={{ width: `${Math.min(100, totals.calories / GOAL * 100)}%` }}/></div><div className="macro-grid"><Macro label="蛋白质" value={totals.protein} unit="g" color="sage"/><Macro label="碳水" value={totals.carbs} unit="g" color="sand"/><Macro label="脂肪" value={totals.fat} unit="g" color="rose"/></div></section>
      <section className="section meal-section"><div className="section-heading"><div><span className="eyebrow">YOUR DAY</span><h2>饮食记录 <span className="count">{meals.length}</span></h2></div><button className="text-button" onClick={() => setEditing("new")}><Plus size={17}/> 添加一餐</button></div>
        <div className="meal-list">{meals.length ? meals.map((item) => <button className="meal-row" key={item.id} onClick={() => setEditing(item)}><div className="meal-thumb">{item.image_path && photoUrls[item.image_path] ? <img src={photoUrls[item.image_path]} alt=""/> : <Leaf size={18}/>}</div><div className="meal-info"><span>{mealLabels[item.meal_type]} <small>{new Date(item.eaten_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span><strong>{item.title}</strong></div><div className="meal-calories"><strong>{Math.round(Number(item.calories))}</strong><small>kcal</small></div></button>) : <div className="empty-meals"><div className="empty-icon"><Camera size={20}/></div><strong>还没有饮食记录</strong><span>{isToday ? "从今天的第一餐开始吧" : "可以为这一天补记"}</span><button onClick={() => setEditing("new")}>记录一餐 <ChevronRight size={15}/></button></div>}</div>
      </section>
      <section className="section weight-section"><div className="section-heading"><div><span className="eyebrow">GENTLE PROGRESS</span><h2>体重记录</h2></div><div className="weight-current"><Scale size={17}/><strong>{currentWeight ? `${currentWeight}` : "—"}</strong><small>kg</small></div></div><form className="weight-form" onSubmit={saveWeight}><input inputMode="decimal" type="number" step="0.1" min="20" max="400" placeholder={isToday ? "输入今天的体重" : `输入 ${shortDate(date)} 的体重`} value={weightInput} onChange={(e) => setWeightInput(e.target.value)}/><button type="submit">记录体重</button></form>{weights.length > 1 ? <div className="weight-history">{weights.slice().reverse().map((w) => <span key={w.id}><i style={{ height: `${Math.max(15, Math.min(70, (w.weight_kg - 35) * 2))}px` }}/><small>{shortDate(w.recorded_on)}</small></span>)}</div> : <p className="weight-hint">轻轻记录，不必追求每天都变化。</p>}</section>
      </>}
      <footer>慢慢来，身体会记得你的用心。 <span>·</span> 仅你和受邀的人可见</footer>
    </div>
    <nav className="tabbar"><button className={tab === "day" ? "active" : ""} onClick={() => setTab("day")}><Sun size={19}/>每日</button><button className="tab-add" aria-label="记录一餐" onClick={() => setEditing("new")}><Plus size={22}/></button><button className={tab === "trends" ? "active" : ""} onClick={() => setTab("trends")}><BarChart3 size={19}/>趋势</button></nav>
    {editing && <MealModal supabase={supabase} userId={session.user.id} date={tab === "day" ? date : todayISO()} initial={editing === "new" ? undefined : editing} initialImageUrl={editing !== "new" && editing.image_path ? photoUrls[editing.image_path] : undefined} onSaved={mealSaved} onDeleted={mealDeleted} onClose={() => setEditing(null)}/>}
  </main>;
}

function Macro({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) { return <div className="macro"><span><i className={color}/>{label}</span><strong>{Math.round(value)}<small>{unit}</small></strong></div>; }
