"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Camera, Check, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { rememberPhoto } from "@/lib/photo-cache";
import { lookupFood, rememberFood, scale } from "@/lib/food-cache";
import { foodKey } from "@/lib/food-names";
import { parseFood, splitFoods } from "@/lib/split-foods";
import { todayISO } from "@/lib/date";
import type { Dish, DishItem, Meal } from "@/lib/types";
import type { MealRow } from "@/lib/outbox";
import type { FoodAnalysis, FoodItem } from "@/lib/vision/types";
import DateField from "./date-field";
import PhotoViewer from "./photo-viewer";

export const mealLabels: Record<Meal["meal_type"], string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };

// 一餐 = 若干照片 + 一张食物表（识别出几种就几行）。每行：名称、重量可改，热量由 AI 按名称+重量估算。
// 改了名称或重量 → 待确认，点 ✓ 才重算；名称清空后 ✓ 变成删除。保存时按照片分组存成 dishes。
type PhotoDraft = { key: string; photo?: File; preview?: string; image_path: string | null; status: "idle" | "analyzing" | "error"; message?: string };
type ItemDraft = {
  key: string;
  photoKey: string | null;
  name: string;
  grams: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  state: "ok" | "dirty" | "computing" | "error";
  message?: string;
  baseName: string; // 上次确认时的名称和重量：只改重量时按比例在本地换算
  baseGrams: number;
};

function guessMealType(): Meal["meal_type"] {
  const hour = new Date().getHours();
  return hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
}

// 新记录：所选日期 + 当前时刻；编辑时改了日期则保留原来的时刻。
function eatenAtFor(date: string, original?: string) {
  if (!original && date === todayISO()) return new Date().toISOString();
  const time = original ? new Date(original) : new Date();
  const d = new Date(`${date}T00:00:00`);
  d.setHours(time.getHours(), time.getMinutes(), time.getSeconds());
  return d.toISOString();
}

const round1 = (v: number) => Math.round(v * 10) / 10;
let seq = 0;
const newKey = () => `k${Date.now()}-${seq++}`;
const sum = <T extends { calories: number; protein_g: number; carbs_g: number; fat_g: number }>(list: T[]) =>
  list.reduce((t, x) => ({ calories: t.calories + x.calories, protein_g: t.protein_g + x.protein_g, carbs_g: t.carbs_g + x.carbs_g, fat_g: t.fat_g + x.fat_g }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

function itemDraft(i: Partial<DishItem> & { name: string }, photoKey: string | null, state: ItemDraft["state"] = "ok"): ItemDraft {
  const grams = i.grams ? Math.round(i.grams) : 0;
  const n = { calories: Number(i.calories ?? 0), protein_g: Number(i.protein_g ?? 0), carbs_g: Number(i.carbs_g ?? 0), fat_g: Number(i.fat_g ?? 0) };
  if (state === "ok") rememberFood(i.name, grams, n);
  return { key: newKey(), photoKey, name: i.name, grams: grams ? String(grams) : "", ...n, state, baseName: state === "ok" ? i.name.trim() : "", baseGrams: state === "ok" ? grams : 0 };
}

function draftsFrom(meal: Meal | undefined, photoUrls: Record<string, string>) {
  const photos: PhotoDraft[] = [];
  const items: ItemDraft[] = [];
  if (!meal) return { photos, items };
  const dishes: Dish[] = meal.dishes?.length ? meal.dishes
    : [{ name: meal.title, calories: meal.calories, protein_g: meal.protein_g, carbs_g: meal.carbs_g, fat_g: meal.fat_g, image_path: meal.image_path }];
  for (const d of dishes) {
    let photoKey: string | null = null;
    if (d.image_path) { photoKey = newKey(); photos.push({ key: photoKey, image_path: d.image_path, preview: photoUrls[d.image_path], status: "idle" }); }
    for (const i of d.items?.length ? d.items : [{ name: d.name, grams: null, calories: d.calories, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g }]) items.push(itemDraft(i, photoKey));
  }
  return { photos, items };
}
export const storedPaths = (meal?: Meal) => draftsFrom(meal, {}).photos.map((p) => p.image_path).filter((p): p is string => !!p);

type Props = {
  supabase: SupabaseClient;
  userId: string;
  date: string;
  initial?: Meal;
  photoUrls: Record<string, string>;
  onSaved: (row: MealRow, upload: string[], remove: string[]) => void;
  onDeleted: (id: string, remove: string[]) => void;
  onClose: () => void;
};

export default function MealModal({ supabase, userId, date: initialDate, initial, photoUrls, onSaved, onDeleted, onClose }: Props) {
  const [initialDrafts] = useState(() => draftsFrom(initial, photoUrls));
  const [date, setDate] = useState(initial ? new Date(initial.eaten_at).toLocaleDateString("sv-SE") : initialDate);
  const [mealType, setMealType] = useState<Meal["meal_type"]>(initial?.meal_type ?? guessMealType());
  const [photos, setPhotos] = useState<PhotoDraft[]>(initialDrafts.photos);
  const [items, setItems] = useState<ItemDraft[]>(initialDrafts.items);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState<"" | "save" | "delete">("");
  const [message, setMessage] = useState("");
  const [viewing, setViewing] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const updatePhoto = (key: string, patch: Partial<PhotoDraft>) => setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const updateItem = (key: string, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const totals = sum(items);
  const autoTitle = items.map((i) => i.name.trim()).filter(Boolean).join("、").slice(0, 160); // 餐食名称自动由食物名组成
  const analyzing = photos.filter((p) => p.status === "analyzing");
  const working = analyzing.length > 0 || items.some((i) => i.state === "computing");

  async function callAnalyze(photo: File): Promise<FoodAnalysis> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登录状态已失效，请重新登录。");
    const body = new FormData();
    body.append("image", photo);
    const response = await fetch("/api/analyze", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body });
    const a = await response.json().catch(() => ({ error: "识图服务暂时不可用，请稍后重试或手动填写。" }));
    if (!response.ok) throw new Error(a.error || "识别暂不可用");
    return a as FoodAnalysis;
  }

  async function addPhotos(files: FileList | null) {
    for (const file of Array.from(files || [])) {
      const key = newKey();
      setPhotos((list) => [...list, { key, image_path: null, status: "analyzing" }]);
      try {
        const photo = await compressImage(file);
        updatePhoto(key, { photo, preview: URL.createObjectURL(photo) });
        const a = await callAnalyze(await compressImage(photo, 1024)); // 识图用 1024px 副本：图片 token 少约 40%，识别不受影响
        const found = a.items.length ? a.items.map((i: FoodItem) => itemDraft(i, key)) : [itemDraft({ name: a.title, calories: a.calories, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g }, key)];
        setItems((list) => [...list, ...found]);
        updatePhoto(key, { status: "idle" });
      } catch (err) { updatePhoto(key, { status: "error", message: err instanceof Error ? err.message : "识别失败" }); }
    }
  }

  function removePhoto(key: string) {
    setPhotos((list) => list.filter((p) => p.key !== key));
    setItems((list) => list.filter((i) => i.photoKey !== key));
  }

  // 确认：名称为空 → 删除这一行；只改了重量 → 按比例本地换算；本地食物库有这个名称 → 本地换算；否则问 AI（只走语言模型）。
  async function confirmItem(item: ItemDraft) {
    let name = item.name.trim();
    if (!name) { setItems((list) => list.filter((i) => i.key !== item.key)); return; }
    // 一行写了多种食物（“红烧鲫鱼100g，番茄炒蛋100g”）：拆成多行，各自估算。
    const parts = splitFoods(name);
    if (parts) {
      const drafts = parts.map((p) => ({ ...itemDraft({ name: p.name }, item.photoKey, "dirty"), grams: p.grams ? String(p.grams) : "" }));
      setItems((list) => list.flatMap((i) => (i.key === item.key ? drafts : [i])));
      drafts.forEach((d) => confirmItem(d));
      return;
    }
    // 重量写进了名称（“番茄炒蛋 200g”）而重量栏空着：挪到重量栏。
    let grams = Number(item.grams) || 0;
    const parsed = parseFood(name);
    if (parsed.grams && !grams) { name = parsed.name; grams = parsed.grams; updateItem(item.key, { name, grams: String(grams) }); }
    const done = (n: { calories: number; protein_g: number; carbs_g: number; fat_g: number }, g: number) => {
      rememberFood(name, g, n);
      updateItem(item.key, { ...n, grams: g ? String(g) : "", state: "ok", message: undefined, baseName: name, baseGrams: g });
    };
    if (grams > 0 && name === item.baseName && item.baseGrams > 0) {
      const f = grams / item.baseGrams;
      return done({ calories: item.calories * f, protein_g: item.protein_g * f, carbs_g: item.carbs_g * f, fat_g: item.fat_g * f }, grams);
    }
    const cached = grams > 0 ? lookupFood(name) : null;
    if (cached) return done(scale(cached, grams), grams);

    updateItem(item.key, { state: "computing", message: undefined });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("登录状态已失效，请重新登录。");
      const response = await fetch("/api/estimate", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, grams }) });
      const r = await response.json().catch(() => ({ error: "AI 估算暂时不可用，请稍后重试。" }));
      if (!response.ok) throw new Error(r.error || "AI 估算失败");
      done({ calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g }, grams || Math.round(r.grams) || 0);
    } catch (err) { updateItem(item.key, { state: "error", message: err instanceof Error ? err.message : "估算失败，请重试" }); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const named = items.filter((i) => i.name.trim());
    if (!named.length) { setMessage("请先拍照识别，或手动添加食物。"); return; }
    if (items.some((i) => i.state === "dirty" || i.state === "error")) { setMessage("还有修改没有确认，请点每行后面的 ✓。"); return; }
    // 先存本地、立刻关闭弹窗；照片上传和写数据库交给后台同步队列。
    setBusy("save"); setMessage("");
    const pathOf = new Map<string, string | null>();
    const upload: string[] = [];
    for (const p of photos) {
      let image_path = p.image_path;
      if (p.photo && !image_path) {
        image_path = `${userId}/${crypto.randomUUID()}.jpg`;
        await rememberPhoto("meal-photos", image_path, p.photo); // 后台上传时从这里取
        upload.push(image_path);
      }
      pathOf.set(p.key, image_path);
    }
    // 按照片分组存成 dishes；手动添加的食物归到一组无照片的 dish。
    const groups = [...photos.map((p) => p.key), null].map((photoKey) => ({ photoKey, list: named.filter((i) => i.photoKey === photoKey || (photoKey === null && !pathOf.has(i.photoKey ?? ""))) }));
    const dishes: Dish[] = groups.filter((g) => g.list.length || (g.photoKey && pathOf.get(g.photoKey))).map(({ photoKey, list }) => {
      const dishItems: DishItem[] = list.map((i) => ({ name: i.name.trim(), key: foodKey(i.name), grams: Number(i.grams) || null, calories: round1(i.calories), protein_g: round1(i.protein_g), carbs_g: round1(i.carbs_g), fat_g: round1(i.fat_g) }));
      const t = sum(dishItems);
      return { name: dishItems.map((i) => i.name).join("、"), image_path: photoKey ? pathOf.get(photoKey) ?? null : null, items: dishItems, calories: round1(t.calories), protein_g: round1(t.protein_g), carbs_g: round1(t.carbs_g), fat_g: round1(t.fat_g) };
    });
    const row: MealRow = {
      id: initial?.id ?? crypto.randomUUID(), user_id: userId,
      meal_type: mealType, title: autoTitle, notes: notes.trim() || null,
      dishes, image_path: dishes.find((d) => d.image_path)?.image_path ?? null,
      calories: Math.round(totals.calories), protein_g: round1(totals.protein_g), carbs_g: round1(totals.carbs_g), fat_g: round1(totals.fat_g),
      eaten_at: eatenAtFor(date, initial?.eaten_at)
    };
    const kept = new Set(dishes.map((d) => d.image_path));
    onSaved(row, upload, storedPaths(initial).filter((p) => !kept.has(p)));
  }

  function remove() {
    if (!initial || !confirm("确定删除这条饮食记录吗？")) return;
    onDeleted(initial.id, storedPaths(initial));
  }

  return <div className="modal-backdrop" onClick={onClose}><section className="meal-modal compact" role="dialog" aria-modal="true" aria-label={initial ? "编辑这一餐" : "记录一餐"} onClick={(e) => e.stopPropagation()}>
    <button type="button" className="close-button modal-close" onClick={onClose} aria-label="关闭"><X size={20}/></button>
    <form onSubmit={save}>
      <div className="form-row">
        <DateField value={date} onChange={setDate}/>
        <label className="field-label">餐次<select value={mealType} onChange={(e) => setMealType(e.target.value as Meal["meal_type"])}>{Object.entries(mealLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }}/>
      <div className="photo-strip">
        {photos.map((p) => <div className={`photo-tile ${p.status}`} key={p.key}>
          <button type="button" disabled={!p.preview} onClick={() => p.preview && setViewing(p.preview)} aria-label="查看照片">{p.preview ? <img src={p.preview} alt=""/> : <Camera size={18}/>}</button>
          {p.status === "analyzing" && <span className="photo-tile-state"><LoaderCircle className="spin" size={18}/></span>}
          <button type="button" className="photo-tile-remove" aria-label="删除这张照片及其食物" onClick={() => removePhoto(p.key)}><X size={12}/></button>
        </div>)}
        <button type="button" className="photo-add" onClick={() => fileInput.current?.click()}><Camera size={20}/><span>{photos.length ? "再拍一张" : "拍照 / 上传"}</span></button>
        {!photos.length && <ul className="photo-hint"><li>有照片后自动识别</li><li>也可直接手动添加</li><li>还可添加未含食物</li></ul>}
      </div>
      {analyzing.length > 0 && <p className="dish-status"><LoaderCircle className="spin" size={14}/> AI 正在识别 {analyzing.length} 张照片…</p>}
      {photos.filter((p) => p.status === "error").map((p) => <p className="dish-status error" key={p.key}>有一张照片识别失败：{p.message}，可以手动添加食物。</p>)}

      <div className="food-table">
        <div className="food-head"><span>食物</span><span>重量</span><span>热量</span><span/></div>
        {items.map((i) => <div className={`food-row ${i.state}`} key={i.key}>
          <input className="food-name" placeholder="食物名称" value={i.name} onChange={(e) => updateItem(i.key, { name: e.target.value, state: "dirty" })}/>
          <label className="food-grams"><input type="number" inputMode="decimal" min="0" placeholder="?" value={i.grams} onChange={(e) => updateItem(i.key, { grams: e.target.value, state: "dirty" })}/><small>g</small></label>
          <span className="food-kcal">{i.state === "ok" ? <>{Math.round(i.calories)}<small> kcal</small></> : i.state === "computing" ? "计算中" : i.state === "error" ? "重试" : "待确认"}</span>
          <button type="button" className="food-confirm" disabled={i.state === "ok" || i.state === "computing"} aria-label={!i.name.trim() ? "删除这一行" : i.state === "ok" ? "已确认" : "确认并重新计算"} onClick={() => confirmItem(i)}>
            {i.state === "computing" ? <LoaderCircle className="spin" size={14}/> : !i.name.trim() && i.state !== "ok" ? <Trash2 size={14}/> : <Check size={15}/>}
          </button>
          {i.state === "error" && i.message && <p className="food-error">{i.message}</p>}
        </div>)}
        <button type="button" className="food-add" onClick={() => setItems((list) => [...list, itemDraft({ name: "" }, null, "dirty")])}><Plus size={14}/> 添加食物</button>
      </div>
      {items.length > 0 && <p className="analysis-disclaimer">名称或重量不对就直接改，再点 ✓ 重新计算（只改重量会在本地直接换算）；多种食物可以用逗号隔开写在一行，点 ✓ 会自动拆开；清空名称再点后面的按钮可删除这一行。</p>}

      {items.length > 0 && <div className="meal-total"><span>合计</span><strong>{Math.round(totals.calories)}<small> kcal</small></strong><span>蛋白 {Math.round(totals.protein_g)}g · 碳水 {Math.round(totals.carbs_g)}g · 脂肪 {Math.round(totals.fat_g)}g</span></div>}

      <label className="field-label">备注<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}/></label>
      {message && <p className="form-message">{message}</p>}
      <button className="primary-button save-button" disabled={!!busy || working}>{busy === "save" ? "正在保存…" : working ? "等待 AI 计算完成…" : initial ? "保存修改" : "保存饮食记录"}</button>
      {initial && <button type="button" className="delete-button" disabled={!!busy} onClick={remove}><Trash2 size={15}/> {busy === "delete" ? "正在删除…" : "删除这条记录"}</button>}
    </form>
    {viewing && <PhotoViewer src={viewing} onClose={() => setViewing("")}/>}
  </section></div>;
}
