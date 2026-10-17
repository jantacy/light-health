"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Camera, ChevronLeft, ChevronRight, Plus, Sun } from "lucide-react";
import { createClient, migrateCookieSession } from "@/lib/supabase/client";
import { addDays, dayRange, localDay, shortDate, shortWeekday, todayISO } from "@/lib/date";
import type { Meal, WeightEntry } from "@/lib/types";
import MealModal, { mealLabels, storedPaths } from "./meal-modal";
import SwipeRow from "./swipe-row";
import Trends from "./trends";
import PhotoViewer from "./photo-viewer";
import SettingsModal, { type Profile } from "./settings-modal";
import Avatar from "./avatar";
import { photoUrl, prunePhotos } from "@/lib/photo-cache";
import { applyPending, enqueue, flush, onOutboxChange, readJobs, type MealRow } from "@/lib/outbox";
import Splash, { refreshQuotes, todayQuote } from "./splash";

const DEFAULT_GOAL = 2000; // 没设置热量阈值时用

function readCache(key: string): { meals: Meal[]; weights: WeightEntry[] } | null {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeCache(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const STALE_NOTICE = "网络不稳定，显示的是上次加载的数据，正在重试…";

export default function Home() {
  const [supabase] = useState(createClient);
  const [session, setSession] = useState<any>(undefined); // undefined：还在读取登录状态，显示启动页
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
  const [viewing, setViewing] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [quote, setQuote] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const pendingCount = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false); // 当天数据没拉到，每 10 秒重试
  const [newVersion, setNewVersion] = useState(""); // 服务器上有比当前页面更新的版本
  const [updateStuck, setUpdateStuck] = useState(false); // 自动刷新过一次仍是旧版本
  const requestedPhotos = useRef(new Set<string>());
  const date = selectedDate;

  useEffect(() => {
    migrateCookieSession(supabase).then(() => supabase.auth.getSession()).then(({ data }) => setSession(data.session ?? null));
    setQuote(todayQuote());
    refreshQuotes().then(() => setQuote(todayQuote()));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) return;
    const { start, end } = dayRange(date);
    Promise.all([
      supabase.from("meal_records").select("*").gte("eaten_at", start).lt("eaten_at", end).order("eaten_at"),
      supabase.from("weight_records").select("*").lte("recorded_on", date).order("recorded_on", { ascending: false }).limit(7)
    ]).then(([m, w]) => {
      // 网络失败时用本机上次缓存的当天数据，避免 Supabase 连不上时页面变空。
      const key = `light-meal:day:${session.user.id}:${date}`;
      if (m.error || w.error) {
        setLoadFailed(true);
        const cached = readCache(key);
        if (cached) { setMeals(applyPending(cached.meals, readJobs(session.user.id), (x) => localDay(x.eaten_at) === date)); setWeights(cached.weights); setNotice(STALE_NOTICE); }
        return;
      }
      setLoadFailed(false); setNotice((n) => (n === STALE_NOTICE ? "" : n));
      setMeals(applyPending((m.data || []) as Meal[], readJobs(session.user.id), (x) => localDay(x.eaten_at) === date)); setWeights((w.data || []) as WeightEntry[]);
      writeCache(key, { meals: m.data, weights: w.data });
    });
  }, [session, date, supabase, refreshKey]);

  useEffect(() => {
    if (!loadFailed) return;
    const timer = setInterval(() => setRefreshKey((k) => k + 1), 10000);
    return () => clearInterval(timer);
  }, [loadFailed]);

  // 昵称和头像。刚登录时客户端可能还没带上新令牌、RLS 会返回空，所以空结果时 1 秒后重试一次。
  async function loadProfile(retry = true) {
    const { data } = await supabase.from("user_profiles").select("phone, nickname, gender, birth_month, birth_day, avatar_path, calorie_goal, target_weight").maybeSingle();
    const p = data as Profile | null;
    if (!p) { if (retry) setTimeout(() => loadProfile(false), 1000); return; }
    setProfile(p);
    if (p.avatar_path) photoUrl(supabase, "avatars", p.avatar_path).then((url) => setAvatarUrl(url ?? ""));
  }
  useEffect(() => { if (session) loadProfile(); }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 热量阈值、目标体重、性别存在资料里；本机记一份，启动时资料还没读回来也不会先闪成默认值。
  const targetsKey = `light-meal:targets:${session?.user?.id}`;
  const cachedTargets = useMemo((): Partial<Profile> => { try { return JSON.parse(localStorage.getItem(targetsKey) || "{}"); } catch { return {}; } }, [targetsKey]);
  const targets = profile ?? cachedTargets;
  const GOAL = targets.calorie_goal || DEFAULT_GOAL;
  useEffect(() => { if (profile) { try { localStorage.setItem(targetsKey, JSON.stringify({ calorie_goal: profile.calorie_goal, target_weight: profile.target_weight, gender: profile.gender })); } catch {} } }, [profile, targetsKey]);


  // 后台同步队列：登录后、联网恢复时、以及有待同步任务时每分钟同步一次。
  const uid: string | undefined = session?.user?.id;
  const syncNow = () => { if (uid) flush(supabase, uid).then((changed) => { if (changed) setRefreshKey((k) => k + 1); }); };
  useEffect(() => {
    if (!uid) return;
    const refresh = () => { const jobs = readJobs(uid); setPending(new Set(jobs.map((j) => j.id))); setRetrying(jobs.some((j) => j.tries > 0)); };
    refresh();
    prunePhotos(readJobs(uid).flatMap((j) => j.upload));
    syncNow();
    const off = onOutboxChange(refresh);
    window.addEventListener("online", syncNow);
    const timer = setInterval(() => { if (readJobs(uid).length) syncNow(); }, 60000);
    return () => { off(); window.removeEventListener("online", syncNow); clearInterval(timer); };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 照片优先从本地缓存读取，没有再从私有 bucket 下载。
  useEffect(() => {
    const paths = [...new Set(meals.flatMap((m) => [m.image_path, ...(m.dishes ?? []).map((d) => d.image_path)]))].filter((p): p is string => !!p && !requestedPhotos.current.has(p));
    if (!paths.length) return;
    paths.forEach((p) => requestedPhotos.current.add(p));
    for (const path of paths) photoUrl(supabase, "meal-photos", path).then((url) => { if (url) setPhotoUrls((urls) => ({ ...urls, [path]: url })); });
  }, [meals, supabase]);

  const totals = useMemo(() => meals.reduce((a, m) => ({ calories: a.calories + Number(m.calories), protein: a.protein + Number(m.protein_g), carbs: a.carbs + Number(m.carbs_g), fat: a.fat + Number(m.fat_g) }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [meals]);
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
      const result = await response.json().catch(() => ({ error: "登录服务暂时不可用，请稍后再试。" }));
      if (!response.ok) throw new Error(result.error || "License 无效");
      const { error } = await supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
      if (error) throw error;
      setAuthMessage("登录成功，正在进入…");
    } catch (err) { setAuthMessage(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoggingIn(false); }
  }

  // 新版本检测：启动、回到前台、每 10 分钟各查一次。
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const check = () => fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then(({ version }) => {
      if (version && version !== process.env.NEXT_PUBLIC_BUILD_ID) setNewVersion(version);
    }).catch(() => {});
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 600000);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearInterval(timer); };
  }, []);

  // 有新版本时自动刷新：先删掉 Service Worker 缓存的旧页面，否则刷新后还是旧版。
  // 记录/设置弹窗开着时先不刷新，免得丢掉正在填的内容；同一版本只自动刷新一次，防止循环。
  useEffect(() => {
    if (!newVersion || editing || showSettings) return;
    try { if (sessionStorage.getItem("light-meal:reloaded-for") === newVersion) { setUpdateStuck(true); return; } sessionStorage.setItem("light-meal:reloaded-for", newVersion); } catch {}
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("light-meal-v")).map((k) => caches.open(k).then((c) => c.delete("/", { ignoreSearch: true })))))
      .catch(() => {})
      .finally(() => location.reload());
  }, [newVersion, editing, showSettings]);

  // 同步提示：从“有待同步”变为“全部同步完”时显示 3 秒。
  useEffect(() => {
    const prev = pendingCount.current;
    pendingCount.current = pending.size;
    if (pending.size > 0) { setSyncDone(false); return; }
    if (prev > 0) { setSyncDone(true); const t = setTimeout(() => setSyncDone(false), 3000); return () => clearTimeout(t); }
  }, [pending]);

  // 先改本地列表并关闭弹窗，再交给后台同步。
  function mealSaved(row: MealRow, upload: string[], remove: string[]) {
    enqueue(row.user_id, { id: row.id, kind: "save", row, upload, remove });
    setMeals((items) => {
      const rest = items.filter((m) => m.id !== row.id);
      return (localDay(row.eaten_at) === date ? [...rest, row as Meal] : rest).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
    });
    setEditing(null); setNotice("");
    syncNow();
  }

  function mealDeleted(id: string, remove: string[]) {
    if (uid) enqueue(uid, { id, kind: "delete", upload: [], remove });
    setMeals((items) => items.filter((m) => m.id !== id));
    setEditing(null); setNotice("");
    syncNow();
  }

  // 一次性的成功提醒：显示 3 秒后自动关闭（期间换成别的提醒就不动它）。
  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 3000);
  }

  async function saveWeight(e: React.FormEvent) {
    e.preventDefault(); const value = Number(weightInput); if (!value || !session) return;
    const { error } = await supabase.from("weight_records").upsert({ user_id: session.user.id, recorded_on: date, weight_kg: value }, { onConflict: "user_id,recorded_on" });
    if (error) setNotice("体重保存失败，请稍后重试。"); else { setWeightInput(""); setRefreshKey((k) => k + 1); flash(`已记录 ${isToday ? "今天" : shortDate(date)}的体重`); }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <main className="setup-screen"><div className="setup-card"><img className="brand-mark" src="/icon.svg" alt=""/><span className="eyebrow">PRIVATE FOOD JOURNAL</span><h1>轻食记</h1><p>请先配置 Supabase 项目，完成后即可开始登录和记录。</p><code>复制 .env.example 为 .env.local 并填入 Supabase URL 与 anon key</code></div></main>;

  if (session === undefined) return <Splash/>;

  if (!session) return <main className="auth-screen"><div className="auth-card"><img className="brand-mark" src="/icon.svg" alt=""/><span className="eyebrow">PRIVATE FOOD JOURNAL</span><h1>好好吃饭，<br/>慢慢记录。</h1><p className="auth-copy">输入受邀手机号和对应的专属 License，打开你的私人饮食记录空间。</p><form onSubmit={signInWithLicense} className="auth-form"><label htmlFor="login-phone">手机号</label><input id="login-phone" type="tel" autoComplete="tel" required placeholder="13800000000" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}/><label htmlFor="license">License</label><input id="license" type="password" autoComplete="current-password" required placeholder="输入你收到的 License" value={licenseInput} onChange={(e) => setLicenseInput(e.target.value)}/><button className="primary-button" type="submit" disabled={loggingIn}>{loggingIn ? "正在验证…" : "登录"} <ChevronRight size={18}/></button></form>{authMessage && <p className="form-message">{authMessage}</p>}<p className="tiny-note">手机号与 License 必须匹配</p></div><div className="auth-decoration"><span>01</span><i/><span>照顾身体，从一餐开始</span></div></main>;

  return <main className="app-shell">
    <header className="topbar"><a className="wordmark" href="#top"><img className="brand-mark small" src="/icon.svg" alt=""/>轻食记</a><div className="topbar-user">{profile?.nickname && <span className="greeting">你好，{profile.nickname}！</span>}<button className="avatar-button" aria-label="设置" onClick={() => { if (!profile) loadProfile(false); setShowSettings(true); }}><Avatar src={avatarUrl} name={profile?.nickname}/></button></div></header>
    <div className="dashboard" id="top">
      {newVersion ? <div className="notice syncing" role="status">{updateStuck ? "发现新版本，请彻底关闭应用后重新打开！" : editing || showSettings ? "发现新版本，关闭弹窗后自动更新" : "发现新版本，正在更新…"}</div>
        : pending.size > 0 ? <div className="notice syncing" role="status">正在同步 {pending.size} 条记录，请等待！{retrying && "（网络不稳定，会自动重试）"}</div>
        : syncDone ? <div className="notice" role="status">所有饮食记录已同步！</div>
        : notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {tab === "trends" ? <Trends supabase={supabase} goal={GOAL} refreshKey={refreshKey} onPickDay={(d) => { setSelectedDate(d); setTab("day"); }}/> : <>
      <section className="welcome"><div><div className="welcome-meta"><span className="eyebrow">{greetingDate}</span><span className="daily-quote">{quote}</span></div><h1>{isToday ? "今天也要，" : "那天也要，"}<em>好好吃饭。</em></h1></div></section>
      <section className="summary-card"><div className="summary-head"><h2>{isToday ? "今日健康" : `${shortDate(date)} 健康`}</h2><div className="date-pill"><button aria-label="查看前一天" onClick={() => shiftDate(-1)}><ChevronLeft size={15}/></button><span className="date-dot"/> {isToday ? "今天" : `${shortDate(date)} ${shortWeekday(date)}`}<button aria-label="查看后一天" onClick={() => shiftDate(1)} disabled={isToday}><ChevronRight size={15}/></button></div></div><div className="calorie-line"><strong>{Math.round(totals.calories).toLocaleString()}</strong><span>kcal</span><small>/ {GOAL.toLocaleString()}</small></div><div className="progress"><i style={{ width: `${Math.min(100, totals.calories / GOAL * 100)}%` }}/></div><div className="macro-grid"><Macro label="蛋白质" value={totals.protein} unit="g" color="sage"/><Macro label="碳水" value={totals.carbs} unit="g" color="sand"/><Macro label="脂肪" value={totals.fat} unit="g" color="rose"/></div>
        <WeightPanel latest={weights[0]} date={date} target={targets.target_weight ?? null} gender={targets.gender ?? null} input={weightInput} onInput={setWeightInput} onSubmit={saveWeight}/></section>
      <section className="section meal-section"><div className="section-heading"><div><span className="eyebrow">YOUR DAY</span><h2>饮食记录 <span className="count">{meals.length}</span></h2></div><button className="text-button" onClick={() => setEditing("new")}><Plus size={17}/> 添加一餐</button></div>
        <div className="meal-list">{meals.length ? meals.map((item) => <SwipeRow key={item.id} onDelete={() => mealDeleted(item.id, storedPaths(item))}><div className="meal-row" role="button" tabIndex={0} onClick={() => setEditing(item)}>{item.image_path && photoUrls[item.image_path] ? <button className="meal-thumb" aria-label="查看照片" onClick={(e) => { e.stopPropagation(); setViewing(photoUrls[item.image_path!]); }}><img src={photoUrls[item.image_path]} alt=""/></button> : <div className="meal-thumb"><img src="/default-meal.svg" alt=""/></div>}<div className="meal-info"><span>{mealLabels[item.meal_type]} <small>{new Date(item.eaten_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}{item.dishes?.length > 1 && ` · ${item.dishes.length} 道菜`}{pending.has(item.id) && <em className="sync-badge">同步中</em>}</small></span><strong>{item.title}</strong></div><div className="meal-calories"><strong>{Math.round(Number(item.calories))}</strong><small>kcal</small></div></div></SwipeRow>) : <div className="empty-meals"><div className="empty-icon"><Camera size={20}/></div><strong>还没有饮食记录</strong><span>{isToday ? "从今天的第一餐开始吧" : "可以为这一天补记"}</span><button onClick={() => setEditing("new")}>记录一餐 <ChevronRight size={15}/></button></div>}</div>
      </section>
      </>}
      <footer>慢慢来，身体会记得你的用心。</footer>
    </div>
    {!editing && !showSettings && <nav className="tabbar"><button className={tab === "day" ? "active" : ""} onClick={() => setTab("day")}><Sun size={19}/>每日</button><button className="tab-add" aria-label="记录一餐" onClick={() => setEditing("new")}><Plus size={22}/></button><button className={tab === "trends" ? "active" : ""} onClick={() => setTab("trends")}><BarChart3 size={19}/>趋势</button></nav>}
    {editing && <MealModal supabase={supabase} userId={session.user.id} date={tab === "day" ? date : todayISO()} initial={editing === "new" ? undefined : editing} photoUrls={photoUrls} onSaved={mealSaved} onDeleted={mealDeleted} onClose={() => setEditing(null)}/>}
    {showSettings && <SettingsModal supabase={supabase} userId={session.user.id} initial={profile} avatarUrl={avatarUrl} onClose={() => setShowSettings(false)} onSaved={(p) => { setProfile(p); setShowSettings(false); flash("资料已保存"); }} onAvatarChanged={(p, url) => { setProfile(p); setAvatarUrl(url); }}/>}
    {viewing && <PhotoViewer src={viewing} onClose={() => setViewing("")}/>}
  </main>;
}

function Macro({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) { return <div className="macro"><span><i className={color}/>{label}</span><strong>{Math.round(value)}<small>{unit}</small></strong></div>; }

// 体重与目标体重的差额：只算正在查看的那天的记录，没记就显示 --。输入框提示上一次的体重，没有就提示目标体重。高于目标超过 5kg、或低于目标太多（男 5kg、女或未设性别 2.5kg）时标红预警。
function WeightPanel({ latest, date, target, gender, input, onInput, onSubmit }: { latest?: WeightEntry; date: string; target: number | null; gender: Profile["gender"]; input: string; onInput: (v: string) => void; onSubmit: (e: React.FormEvent) => void }) {
  const weight = latest?.recorded_on === date ? Number(latest.weight_kg) : null;
  const hint = latest ? Number(latest.weight_kg) : target ? Number(target) : null;
  // iPhone 弹出键盘时会把页面往上推，收起后不会自动回来：点输入框前记下位置，离开输入框时滚回去。
  const scrollBefore = useRef<number | null>(null);
  const remember = () => { if (scrollBefore.current === null) scrollBefore.current = window.scrollY; };
  const restore = () => { const top = scrollBefore.current; scrollBefore.current = null; if (top !== null) setTimeout(() => window.scrollTo({ top, behavior: "smooth" }), 60); };
  const diff = weight !== null && target ? Math.round((weight - Number(target)) * 10) / 10 : null;
  const limit = diff !== null && diff > 0 ? 5 : gender === "male" ? 5 : 2.5;
  let tip: string, warn = false;
  if (!target) tip = "在设置里填上目标体重，这里会帮你算差额";
  else if (diff === null) tip = "距目标还差 -- kg";
  else if (Math.abs(diff) > limit) { tip = `预警：已${diff > 0 ? "高" : "低"}于目标 ${Math.abs(diff).toFixed(1)} kg，请注意合理控制体重！`; warn = true; }
  else if (diff > 0) tip = `距目标还差 ${diff.toFixed(1)} kg，请继续加油哦～`;
  else if (diff === 0) tip = "刚好达到目标体重，你真的太棒了！";
  else tip = `已低于目标 ${(-diff).toFixed(1)} kg，你真的太棒了！`;
  return <div className="weight-panel">
    <div className="weight-panel-row">
      <div className="weight-panel-now">
        <span>体重</span>
        <strong>{weight !== null ? weight.toFixed(1) : "--"}<small> kg</small></strong>
        {target ? <em>目标 {Number(target).toFixed(1)} kg</em> : null}
      </div>
      <form className="weight-panel-form" onSubmit={onSubmit}>
        <input inputMode="decimal" type="number" step="0.1" min="20" max="400" placeholder={hint ? `${hint.toFixed(1)} kg` : "kg"} aria-label="记录体重" onTouchStart={remember} onFocus={remember} onBlur={restore} value={input} onChange={(e) => onInput(e.target.value)}/>
        <button type="submit">记录</button>
      </form>
    </div>
    <p className={`weight-tip${warn ? " warn" : ""}`}>{tip}</p>
  </div>;
}
