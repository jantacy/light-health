"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Flame, Leaf, LoaderCircle, LogOut, Plus, Scale, Sparkles, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Meal, WeightEntry } from "@/lib/types";

const labels: Record<Meal["meal_type"], string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const todayISO = () => new Date().toLocaleDateString("sv-SE");
const emptyMeal = { title: "", meal_type: "lunch" as Meal["meal_type"], calories: "", protein_g: "", carbs_g: "", fat_g: "" };

export default function Home() {
  const [supabase] = useState(createClient);
  const [session, setSession] = useState<any>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [licenseInput, setLicenseInput] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [showMeal, setShowMeal] = useState(false);
  const [meal, setMeal] = useState(emptyMeal);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const fileInput = useRef<HTMLInputElement>(null);
  const date = selectedDate;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      supabase.from("meal_records").select("*").gte("eaten_at", `${date}T00:00:00`).lt("eaten_at", `${date}T23:59:59.999`).order("eaten_at"),
      supabase.from("weight_records").select("*").order("recorded_on", { ascending: false }).limit(7)
    ]).then(([m, w]) => { setMeals((m.data || []) as Meal[]); setWeights((w.data || []) as WeightEntry[]); });
  }, [session, date, supabase]);

  const totals = useMemo(() => meals.reduce((a, m) => ({ calories: a.calories + m.calories, protein: a.protein + m.protein_g, carbs: a.carbs + m.carbs_g, fat: a.fat + m.fat_g }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [meals]);
  const currentWeight = weights[0]?.weight_kg;
  const dateObject = new Date(`${date}T12:00:00`);
  const greetingDate = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(dateObject);
  const isToday = date === todayISO();
  function shiftDate(delta: number) {
    const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + delta);
    if (next <= new Date(`${todayISO()}T23:59:59`)) setSelectedDate(next.toLocaleDateString("sv-SE"));
  }

  function choosePhoto(file?: File) {
    if (!file) return;
    setPhoto(file); setPreview(URL.createObjectURL(file));
    setMeal((v) => ({ ...v, title: v.title || file.name.replace(/\.[^.]+$/, "") }));
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

  async function analyzePhoto() {
    if (!photo) return;
    setSaving(true); setNotice("");
    try {
      const form = new FormData(); form.append("image", photo);
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) throw new Error("登录状态已失效，请重新登录。");
      const response = await fetch("/api/analyze", { method: "POST", headers: { Authorization: `Bearer ${currentSession.access_token}` }, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "识别暂不可用");
      setMeal((v) => ({ ...v, title: result.title ?? v.title, calories: String(result.calories ?? ""), protein_g: String(result.protein_g ?? ""), carbs_g: String(result.carbs_g ?? ""), fat_g: String(result.fat_g ?? "") }));
      setNotice("识别完成，可以检查并修改下方营养数据。");
    } catch (err) { setNotice(err instanceof Error ? err.message : "识别暂不可用"); }
    finally { setSaving(false); }
  }

  async function saveMeal(e: React.FormEvent) {
    e.preventDefault(); if (!session) return;
    setSaving(true); setNotice("");
    try {
      let image_path: string | null = null;
      if (photo) {
        const suffix = photo.name.split(".").pop() || "jpg";
        image_path = `${session.user.id}/${crypto.randomUUID()}.${suffix}`;
        const { error } = await supabase.storage.from("meal-photos").upload(image_path, photo, { upsert: false, contentType: photo.type });
        if (error) throw error;
      }
      const row = { user_id: session.user.id, eaten_at: new Date().toISOString(), meal_type: meal.meal_type, title: meal.title.trim(), image_path, calories: Number(meal.calories || 0), protein_g: Number(meal.protein_g || 0), carbs_g: Number(meal.carbs_g || 0), fat_g: Number(meal.fat_g || 0) };
      const { data, error } = await supabase.from("meal_records").insert(row).select().single();
      if (error) throw error;
      setMeals((items) => [...items, data as Meal]); setMeal(emptyMeal); setPhoto(null); setPreview(""); setShowMeal(false); setNotice("已保存这条饮食记录");
    } catch (err) { setNotice(err instanceof Error ? err.message : "保存失败，请检查 Supabase 配置"); }
    finally { setSaving(false); }
  }

  async function saveWeight(e: React.FormEvent) {
    e.preventDefault(); const value = Number(weightInput); if (!value || !session) return;
    const { data, error } = await supabase.from("weight_records").upsert({ user_id: session.user.id, recorded_on: date, weight_kg: value }, { onConflict: "user_id,recorded_on" }).select().single();
    if (error) setNotice("体重保存失败，请检查 Supabase 配置。"); else { setWeights((rows) => [data as WeightEntry, ...rows.filter((r) => r.recorded_on !== date)].slice(0, 7)); setWeightInput(""); setNotice("体重已记录"); }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><Leaf size={23}/></div><span className="eyebrow">PRIVATE FOOD JOURNAL</span><h1>轻食记</h1><p>请先配置 Supabase 项目，完成后即可开始登录和记录。</p><code>复制 .env.example 为 .env.local 并填入 Supabase URL 与 anon key</code></div></main>;

  if (!session) return <main className="auth-screen"><div className="auth-card"><div className="brand-mark"><Leaf size={24}/></div><span className="eyebrow">PRIVATE FOOD JOURNAL</span><h1>好好吃饭，<br/>慢慢记录。</h1><p className="auth-copy">输入受邀手机号和对应的专属 License，打开你的私人饮食记录空间。</p><form onSubmit={signInWithLicense} className="auth-form"><label htmlFor="login-phone">手机号</label><input id="login-phone" type="tel" autoComplete="tel" required placeholder="+8613800000000" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}/><label htmlFor="license">License</label><input id="license" type="password" autoComplete="current-password" required placeholder="输入你收到的 License" value={licenseInput} onChange={(e) => setLicenseInput(e.target.value)}/><button className="primary-button" type="submit" disabled={loggingIn}>{loggingIn ? "正在验证…" : "登录"} <ChevronRight size={18}/></button></form>{authMessage && <p className="form-message">{authMessage}</p>}<p className="tiny-note">手机号与 License 必须匹配</p></div><div className="auth-decoration"><span>01</span><i/><span>照顾身体，从一餐开始</span></div></main>;

  return <main className="app-shell">
    <header className="topbar"><a className="wordmark" href="#top"><span className="brand-mark small"><Leaf size={17}/></span>轻食记</a><div className="user-menu"><span>已授权用户</span><button title="退出登录" onClick={() => supabase.auth.signOut()}><LogOut size={17}/></button></div></header>
    <div className="dashboard" id="top">
      <section className="welcome"><div><span className="eyebrow">{greetingDate}</span><h1>{isToday ? "今天也要，" : "那天也要，"}<em>好好吃饭。</em></h1><p>记录每一餐，照顾好自己的节奏。</p></div><div className="date-pill"><button aria-label="查看前一天" onClick={() => shiftDate(-1)}><ChevronLeft size={15}/></button><span className="date-dot"/> {isToday ? "今天" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(dateObject)}<button aria-label="查看后一天" onClick={() => shiftDate(1)} disabled={isToday}><ChevronRight size={15}/></button></div></section>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}><X size={15}/></button></div>}
      <section className="summary-card"><div className="summary-head"><div><span className="eyebrow light">TODAY’S INTAKE</span><h2>今日摄入</h2></div><span className="flame-icon"><Flame size={19}/></span></div><div className="calorie-line"><strong>{Math.round(totals.calories).toLocaleString()}</strong><span>kcal</span><small>/ 2,000</small></div><div className="progress"><i style={{ width: `${Math.min(100, totals.calories / 2000 * 100)}%` }}/></div><div className="macro-grid"><Macro label="蛋白质" value={totals.protein} unit="g" color="sage"/><Macro label="碳水" value={totals.carbs} unit="g" color="sand"/><Macro label="脂肪" value={totals.fat} unit="g" color="rose"/></div></section>
      <section className="section meal-section"><div className="section-heading"><div><span className="eyebrow">YOUR DAY</span><h2>饮食记录 <span className="count">{meals.length}</span></h2></div><button className="text-button" onClick={() => setShowMeal(true)}><Plus size={17}/> 添加一餐</button></div>
        <div className="meal-list">{meals.length ? meals.map((item) => <article className="meal-row" key={item.id}><div className="meal-thumb"><Leaf size={18}/></div><div className="meal-info"><span>{labels[item.meal_type]} <small>{new Date(item.eaten_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span><strong>{item.title}</strong></div><div className="meal-calories"><strong>{item.calories}</strong><small>kcal</small></div></article>) : <div className="empty-meals"><div className="empty-icon"><Camera size={20}/></div><strong>还没有饮食记录</strong><span>从今天的第一餐开始吧</span><button onClick={() => setShowMeal(true)}>记录一餐 <ChevronRight size={15}/></button></div>}</div>
      </section>
      <section className="section weight-section"><div className="section-heading"><div><span className="eyebrow">GENTLE PROGRESS</span><h2>体重记录</h2></div><div className="weight-current"><Scale size={17}/><strong>{currentWeight ? `${currentWeight}` : "—"}</strong><small>kg</small></div></div><form className="weight-form" onSubmit={saveWeight}><input inputMode="decimal" type="number" step="0.1" min="20" max="400" placeholder="输入今天的体重" value={weightInput} onChange={(e) => setWeightInput(e.target.value)}/><button type="submit">记录体重</button></form>{weights.length > 1 ? <div className="weight-history">{weights.slice().reverse().map((w) => <span key={w.id}><i style={{ height: `${Math.max(15, Math.min(70, (w.weight_kg - 35) * 2))}px` }}/><small>{new Date(`${w.recorded_on}T12:00:00`).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</small></span>)}</div> : <p className="weight-hint">轻轻记录，不必追求每天都变化。</p>}</section>
      <footer>慢慢来，身体会记得你的用心。 <span>·</span> 仅你和受邀的人可见</footer>
    </div>
    {showMeal && <div className="modal-backdrop" onClick={() => setShowMeal(false)}><section className="meal-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NEW ENTRY</span><h2 id="modal-title">记录一餐</h2></div><button className="close-button" onClick={() => setShowMeal(false)}><X size={20}/></button></div><form onSubmit={saveMeal}>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => choosePhoto(e.target.files?.[0])}/><button type="button" className={`upload-area ${preview ? "has-image" : ""}`} onClick={() => fileInput.current?.click()}>{preview ? <img src={preview} alt="所选饮食照片预览"/> : <><span className="upload-icon"><Upload size={20}/></span><strong>拍照或上传照片</strong><small>支持 JPG、PNG、HEIC</small></>}</button>
      {photo && <button type="button" className="analyze-button" disabled={saving} onClick={analyzePhoto}>{saving ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} AI 估算营养 <span>可手动修改</span></button>}
      <label className="field-label">餐食名称<input required placeholder="例如：鸡胸肉藜麦沙拉" value={meal.title} onChange={(e) => setMeal({ ...meal, title: e.target.value })}/></label><label className="field-label">餐次<select value={meal.meal_type} onChange={(e) => setMeal({ ...meal, meal_type: e.target.value as Meal["meal_type"] })}>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><div className="nutrition-fields"><label className="field-label">热量 kcal<input type="number" min="0" placeholder="0" value={meal.calories} onChange={(e) => setMeal({ ...meal, calories: e.target.value })}/></label><label className="field-label">蛋白质 g<input type="number" min="0" step="0.1" placeholder="0" value={meal.protein_g} onChange={(e) => setMeal({ ...meal, protein_g: e.target.value })}/></label><label className="field-label">碳水 g<input type="number" min="0" step="0.1" placeholder="0" value={meal.carbs_g} onChange={(e) => setMeal({ ...meal, carbs_g: e.target.value })}/></label><label className="field-label">脂肪 g<input type="number" min="0" step="0.1" placeholder="0" value={meal.fat_g} onChange={(e) => setMeal({ ...meal, fat_g: e.target.value })}/></label></div><button className="primary-button save-button" disabled={saving}>{saving ? "正在保存…" : "保存饮食记录"}</button></form></section></div>}
  </main>;
}

function Macro({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) { return <div className="macro"><span><i className={color}/>{label}</span><strong>{Math.round(value)}<small>{unit}</small></strong></div>; }
