"use client";

import { useEffect, useState } from "react";
import BrandIcon from "@/components/brand-icon";

// 管理页：共享食物库、按手机号查用户。面向电脑浏览器，界面和用户端分开。
// 管理员密钥只存在本标签页的 sessionStorage，关闭标签页即清除。
type Food = { name: string; display_name: string; calories_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; source: string; uses: number; needs_refresh: boolean; updated_at: string };
type Item = { name: string; grams: number | null; calories: number; protein_g: number; carbs_g: number; fat_g: number };
type Meal = { id: string; eaten_at: string; meal_type: string; title: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; notes: string | null; image_path: string | null; dishes: { name: string; image_path: string | null; items?: Item[] }[] };
type UserDetail = {
  license: { phone: string; status: string; created_at: string; updated_at: string; user_id: string | null };
  profile: { nickname: string | null; gender: string | null; birth_month: number | null; birth_day: number | null; calorie_goal: number | null; target_weight: number | null; theme: string | null; updated_at: string } | null;
  auth: { created_at: string; last_sign_in_at: string | null } | null;
  summary: { meals: number; weights: number; first: string | null; last: string | null } | null;
  meals: Meal[]; weights: { recorded_on: string; weight_kg: number }[]; photos: Record<string, string>; days: number;
};

const SOURCES: Record<string, string> = { cfct: "成分表", ai: "AI 估算", photo: "识图", manual: "手动" };
const MEALS: Record<string, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const KEY = "light-meal:admin-key";
const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—");
const day = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState<"foods" | "users">("foods");
  useEffect(() => { try { setSecret(sessionStorage.getItem(KEY) ?? ""); } catch {} }, []);
  const saveSecret = (v: string) => { setSecret(v); try { sessionStorage.setItem(KEY, v); } catch {} };

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "x-license-admin-key": secret, ...init.headers } });
    const body = await res.json().catch(() => ({ error: "服务暂时不可用" }));
    if (!res.ok) throw new Error(body.error || "请求失败");
    return body as T;
  }

  return <main className="admin">
    <header className="admin-head">
      <div className="admin-title"><BrandIcon className="brand-mark small"/><strong>轻食记 · 管理</strong></div>
      <nav className="segmented"><button className={tab === "foods" ? "active" : ""} onClick={() => setTab("foods")}>食物库</button><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>用户查询</button></nav>
      <input className="admin-secret" type="password" autoComplete="off" placeholder="管理员密钥 LICENSE_ADMIN_SECRET" value={secret} onChange={(e) => saveSecret(e.target.value)}/>
      <a className="admin-link" href="/admin/licenses">签发 License →</a>
    </header>
    {secret.length < 32 ? <p className="admin-empty">先填写管理员密钥（至少 32 位）。</p> : tab === "foods" ? <Foods api={api}/> : <Users api={api}/>}
  </main>;
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

function Foods({ api }: { api: Api }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: Food[]; total: number; pageSize: number } | null>(null);
  const [editing, setEditing] = useState<Food | null>(null);
  const [adding, setAdding] = useState<Partial<Food> | null>(null);
  const [message, setMessage] = useState("");

  const load = () => api<{ rows: Food[]; total: number; pageSize: number }>(`/api/admin/foods?q=${encodeURIComponent(q)}&source=${source}&page=${page}`).then(setData).catch((e) => setMessage(e.message));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, source, page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(method: "PATCH" | "POST", food: Partial<Food>) {
    try { await api("/api/admin/foods", { method, body: JSON.stringify(food) }); setEditing(null); setAdding(null); setMessage(method === "POST" ? `已新增：${food.display_name}` : `已保存：${food.display_name}（来源改为“手动”，AI 不再重估）`); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "保存失败"); }
  }
  async function remove(f: Food) {
    if (!confirm(`删除“${f.display_name}”？用户历史记录不受影响，以后再遇到这种食物会重新估算入库。`)) return;
    try { await api("/api/admin/foods", { method: "DELETE", body: JSON.stringify({ name: f.name }) }); setMessage(`已删除：${f.display_name}`); load(); } catch (e) { setMessage(e instanceof Error ? e.message : "删除失败"); }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const numberCell = (f: Partial<Food>, set: (f: Partial<Food>) => void, k: keyof Food) => <td><input className="admin-num" type="number" step="0.1" min="0" value={(f[k] as number | undefined) ?? ""} onChange={(e) => set({ ...f, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}/></td>;

  return <section className="admin-panel">
    <div className="admin-toolbar">
      <input placeholder="搜索名称或库键（同义名也能搜到，如“西红柿”）" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}/>
      <select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}><option value="">全部来源</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <button className="admin-btn primary" onClick={() => setAdding({ display_name: q })}>＋ 新增食物</button>
      <span className="admin-muted">共 {data?.total ?? "…"} 条</span>
    </div>
    {message && <p className="admin-msg">{message}</p>}
    <p className="admin-muted">数值都是每 100 克。来源为“成分表”和“手动”的不会被 AI 定时重估；修改任何一条都会变成“手动”。用户已保存的历史记录不受食物库修改影响。</p>
    <table className="admin-table">
      <thead><tr><th>名称</th><th>库键</th><th>热量 kcal</th><th>蛋白质 g</th><th>碳水 g</th><th>脂肪 g</th><th>来源</th><th>使用次数</th><th>更新时间</th><th/></tr></thead>
      <tbody>
        {adding && <tr className="admin-editing">
          <td><input value={adding.display_name ?? ""} placeholder="名称" onChange={(e) => setAdding({ ...adding, display_name: e.target.value })}/></td><td className="admin-muted">自动生成</td>
          {numberCell(adding, setAdding, "calories_100g")}{numberCell(adding, setAdding, "protein_100g")}{numberCell(adding, setAdding, "carbs_100g")}{numberCell(adding, setAdding, "fat_100g")}
          <td>手动</td><td/><td/><td className="admin-actions"><button className="admin-btn primary" onClick={() => save("POST", adding)}>保存</button><button className="admin-btn" onClick={() => setAdding(null)}>取消</button></td>
        </tr>}
        {data?.rows.map((f) => editing?.name === f.name ? <tr key={f.name} className="admin-editing">
          <td><input value={editing.display_name} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })}/></td><td className="admin-muted">{f.name}</td>
          {numberCell(editing, (v) => setEditing(v as Food), "calories_100g")}{numberCell(editing, (v) => setEditing(v as Food), "protein_100g")}{numberCell(editing, (v) => setEditing(v as Food), "carbs_100g")}{numberCell(editing, (v) => setEditing(v as Food), "fat_100g")}
          <td>{SOURCES[f.source] ?? f.source}</td><td>{f.uses}</td><td>{time(f.updated_at)}</td>
          <td className="admin-actions"><button className="admin-btn primary" onClick={() => save("PATCH", editing)}>保存</button><button className="admin-btn" onClick={() => setEditing(null)}>取消</button></td>
        </tr> : <tr key={f.name}>
          <td>{f.display_name}</td><td className="admin-muted">{f.name}</td><td>{f.calories_100g}</td><td>{f.protein_100g}</td><td>{f.carbs_100g}</td><td>{f.fat_100g}</td>
          <td><span className={`admin-tag ${f.source}`}>{SOURCES[f.source] ?? f.source}</span>{f.needs_refresh && <span className="admin-tag">待重估</span>}</td><td>{f.uses}</td><td>{time(f.updated_at)}</td>
          <td className="admin-actions"><button className="admin-btn" onClick={() => setEditing(f)}>修改</button><button className="admin-btn danger" onClick={() => remove(f)}>删除</button></td>
        </tr>)}
      </tbody>
    </table>
    <div className="admin-pager"><button className="admin-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {pages}</span><button className="admin-btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页</button></div>
  </section>;
}

function Users({ api }: { api: Api }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ phone: string; status: string; registered: boolean; nickname: string | null }[]>([]);
  const [phone, setPhone] = useState("");
  const [days, setDays] = useState(14);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { const t = setTimeout(() => api<{ users: typeof list }>(`/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => setList(r.users)).catch((e) => setMessage(e.message)), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!phone) return; setDetail(null); api<UserDetail>(`/api/admin/users?phone=${encodeURIComponent(phone)}&days=${days}`).then(setDetail).catch((e) => setMessage(e.message)); }, [phone, days]); // eslint-disable-line react-hooks/exhaustive-deps

  // 按天汇总：热量、蛋白质、餐数、体重
  const daily = detail ? [...new Set([...detail.meals.map((m) => day(m.eaten_at)), ...detail.weights.map((w) => w.recorded_on)])].sort().reverse().map((d) => {
    const ms = detail.meals.filter((m) => day(m.eaten_at) === d);
    return { d, meals: ms.length, kcal: Math.round(ms.reduce((s, m) => s + Number(m.calories), 0)), protein: Math.round(ms.reduce((s, m) => s + Number(m.protein_g), 0)), weight: detail.weights.find((w) => w.recorded_on === d)?.weight_kg };
  }) : [];
  const p = detail?.profile;

  return <section className="admin-users">
    <aside className="admin-panel admin-list">
      <input placeholder="手机号（可只输一部分）" value={q} onChange={(e) => setQ(e.target.value)}/>
      {list.map((u) => <button key={u.phone} className={u.phone === phone ? "active" : ""} onClick={() => setPhone(u.phone)}>
        <strong>{u.phone.replace(/^\+86/, "")}</strong><span>{u.nickname ?? "未设昵称"}{u.status === "revoked" ? " · 已撤销" : !u.registered ? " · 未登录过" : ""}</span>
      </button>)}
      {!list.length && <p className="admin-muted">没有匹配的手机号</p>}
    </aside>
    <div className="admin-detail">
      {message && <p className="admin-msg">{message}</p>}
      {!phone ? <p className="admin-empty">从左侧选择一个用户。</p> : !detail ? <p className="admin-empty">正在读取…</p> : <>
        <div className="admin-cards">
          <div className="admin-panel"><h3>账号</h3><dl>
            <dt>手机号</dt><dd>{detail.license.phone}</dd><dt>License</dt><dd>{detail.license.status === "active" ? "有效" : "已撤销"}（签发 {time(detail.license.updated_at)}）</dd>
            <dt>首次登录</dt><dd>{time(detail.auth?.created_at)}</dd><dt>最近登录</dt><dd>{time(detail.auth?.last_sign_in_at)}</dd>
          </dl></div>
          <div className="admin-panel"><h3>资料</h3><dl>
            <dt>昵称</dt><dd>{p?.nickname ?? "—"}</dd><dt>性别</dt><dd>{p?.gender === "male" ? "男" : p?.gender === "female" ? "女" : "—"}</dd>
            <dt>生日</dt><dd>{p?.birth_month ? `${p.birth_month} 月 ${p.birth_day ?? "?"} 日` : "—"}</dd><dt>热量阈值</dt><dd>{p?.calorie_goal ?? "默认 2000"} kcal</dd>
            <dt>目标体重</dt><dd>{p?.target_weight ? `${p.target_weight} kg` : "—"}</dd><dt>主题色</dt><dd>{p?.theme ?? "青绿（默认）"}</dd>
          </dl></div>
          <div className="admin-panel"><h3>汇总</h3><dl>
            <dt>饮食记录</dt><dd>{detail.summary?.meals ?? 0} 条</dd><dt>体重记录</dt><dd>{detail.summary?.weights ?? 0} 条</dd>
            <dt>最早记录</dt><dd>{time(detail.summary?.first)}</dd><dt>最近记录</dt><dd>{time(detail.summary?.last)}</dd>
          </dl></div>
        </div>
        <div className="admin-toolbar"><span>最近</span><div className="segmented">{[7, 14, 30, 90].map((n) => <button key={n} className={days === n ? "active" : ""} onClick={() => setDays(n)}>{n} 天</button>)}</div></div>
        <div className="admin-panel"><h3>每日汇总</h3>
          <table className="admin-table"><thead><tr><th>日期</th><th>餐数</th><th>热量 kcal</th><th>蛋白质 g</th><th>体重 kg</th></tr></thead>
            <tbody>{daily.map((r) => <tr key={r.d}><td>{r.d}</td><td>{r.meals || "—"}</td><td className={p?.calorie_goal && r.kcal > p.calorie_goal ? "admin-over" : ""}>{r.meals ? r.kcal : "—"}</td><td>{r.meals ? r.protein : "—"}</td><td>{r.weight ?? "—"}</td></tr>)}</tbody></table>
          {!daily.length && <p className="admin-muted">这段时间没有记录</p>}
        </div>
        <div className="admin-panel"><h3>饮食明细</h3>
          {detail.meals.map((m) => <article key={m.id} className="admin-meal">
            <header><strong>{time(m.eaten_at)} · {MEALS[m.meal_type] ?? m.meal_type}</strong><span>{Math.round(m.calories)} kcal · 蛋白 {m.protein_g}g · 碳水 {m.carbs_g}g · 脂肪 {m.fat_g}g</span></header>
            {(m.dishes?.length ? m.dishes : [{ name: m.title, image_path: m.image_path }]).map((d, i) => <div key={i} className="admin-dish">
              {d.image_path && detail.photos[d.image_path] ? <a href={detail.photos[d.image_path]} target="_blank" rel="noreferrer"><img src={detail.photos[d.image_path]} alt=""/></a> : <div className="admin-nophoto">无照片</div>}
              <table className="admin-table compact"><tbody>{(d.items?.length ? d.items : [{ name: d.name, grams: null, calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g }]).map((it, j) => <tr key={j}><td>{it.name}</td><td>{it.grams ? `${it.grams} g` : "—"}</td><td>{Math.round(it.calories)} kcal</td><td className="admin-muted">蛋白 {it.protein_g} · 碳水 {it.carbs_g} · 脂肪 {it.fat_g}</td></tr>)}</tbody></table>
            </div>)}
            {m.notes && <p className="admin-muted">备注：{m.notes}</p>}
          </article>)}
          {!detail.meals.length && <p className="admin-muted">这段时间没有饮食记录</p>}
        </div>
      </>}
    </div>
  </section>;
}
