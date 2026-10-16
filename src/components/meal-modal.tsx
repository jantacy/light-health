"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Camera, Check, LoaderCircle, PenLine, Plus, Trash2, UtensilsCrossed, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { rememberPhoto } from "@/lib/photo-cache";
import { todayISO } from "@/lib/date";
import type { Dish, DishItem, Meal } from "@/lib/types";
import type { FoodAnalysis, FoodItem } from "@/lib/vision/types";
import DateField from "./date-field";
import PhotoViewer from "./photo-viewer";

export const mealLabels: Record<Meal["meal_type"], string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const confidenceLabels = { high: "把握较高", medium: "把握一般", low: "把握较低" };

// 一餐 → 若干道菜（通常一张照片一道）→ 每道菜若干食物项。
// 食物项的名称和重量可改；改了之后变成“待确认”，点 ✓ 才让 AI 按名称+重量重算热量和三大营养素。
type ItemDraft = {
  key: string;
  name: string;
  grams: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  state: "ok" | "dirty" | "computing" | "error";
  message?: string;
};
type DishDraft = {
  key: string;
  photo?: File;
  preview?: string;
  image_path: string | null;
  status: "idle" | "analyzing" | "error";
  message?: string;
  items: ItemDraft[];
  confidence?: FoodAnalysis["confidence"];
  notes?: string;
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
const dishName = (d: DishDraft) => d.items.map((i) => i.name.trim()).filter(Boolean).join("、");

function itemDraft(i: Partial<DishItem> & { name: string }, state: ItemDraft["state"] = "ok"): ItemDraft {
  return { key: newKey(), name: i.name, grams: i.grams ? String(Math.round(i.grams)) : "", calories: Number(i.calories ?? 0), protein_g: Number(i.protein_g ?? 0), carbs_g: Number(i.carbs_g ?? 0), fat_g: Number(i.fat_g ?? 0), state };
}
const emptyItem = () => itemDraft({ name: "" }, "dirty");

function draftsFrom(meal: Meal | undefined, photoUrls: Record<string, string>): DishDraft[] {
  if (!meal) return [];
  const dishes: Dish[] = meal.dishes?.length ? meal.dishes
    : [{ name: meal.title, calories: meal.calories, protein_g: meal.protein_g, carbs_g: meal.carbs_g, fat_g: meal.fat_g, image_path: meal.image_path }];
  return dishes.map((d) => ({
    key: newKey(), image_path: d.image_path, status: "idle", preview: d.image_path ? photoUrls[d.image_path] : undefined,
    items: (d.items?.length ? d.items : [{ name: d.name, grams: null, calories: d.calories, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g }]).map((i) => itemDraft(i))
  }));
}

type Props = {
  supabase: SupabaseClient;
  userId: string;
  date: string;
  initial?: Meal;
  photoUrls: Record<string, string>;
  onSaved: (meal: Meal) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
};

export default function MealModal({ supabase, userId, date: initialDate, initial, photoUrls, onSaved, onDeleted, onClose }: Props) {
  const [date, setDate] = useState(initial ? new Date(initial.eaten_at).toLocaleDateString("sv-SE") : initialDate);
  const [mealType, setMealType] = useState<Meal["meal_type"]>(initial?.meal_type ?? guessMealType());
  const [dishes, setDishes] = useState<DishDraft[]>(() => draftsFrom(initial, photoUrls));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState<"" | "save" | "delete">("");
  const [message, setMessage] = useState("");
  const [viewing, setViewing] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const updateDish = (key: string, patch: Partial<DishDraft> | ((d: DishDraft) => Partial<DishDraft>)) =>
    setDishes((list) => list.map((d) => (d.key === key ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) } : d)));
  const updateItem = (dishKey: string, itemKey: string, patch: Partial<ItemDraft>) =>
    updateDish(dishKey, (d) => ({ items: d.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }));

  const allItems = dishes.flatMap((d) => d.items);
  const totals = sum(allItems);
  const autoTitle = dishes.map(dishName).filter(Boolean).join("、").slice(0, 160);
  const shownTitle = titleTouched ? title : autoTitle;
  const working = dishes.some((d) => d.status === "analyzing") || allItems.some((i) => i.state === "computing");

  async function callAnalyze(photo: File | undefined, hint: string | undefined): Promise<FoodAnalysis> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登录状态已失效，请重新登录。");
    const body = new FormData();
    if (photo) body.append("image", photo);
    if (hint) body.append("hint", hint);
    const response = await fetch("/api/analyze", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body });
    const a = await response.json().catch(() => ({ error: "识图服务暂时不可用，请稍后重试或手动填写。" }));
    if (!response.ok) throw new Error(a.error || "识别暂不可用");
    return a as FoodAnalysis;
  }

  async function addPhotos(files: FileList | null) {
    for (const file of Array.from(files || [])) {
      const key = newKey();
      setDishes((list) => [...list, { key, image_path: null, status: "analyzing", items: [] }]);
      try {
        const photo = await compressImage(file);
        updateDish(key, { photo, preview: URL.createObjectURL(photo) });
        const a = await callAnalyze(photo, undefined);
        const items = a.items.length ? a.items.map((i: FoodItem) => itemDraft(i)) : [itemDraft({ name: a.title, calories: a.calories, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g })];
        updateDish(key, { status: "idle", items, confidence: a.confidence, notes: a.notes });
      } catch (err) { updateDish(key, { status: "error", message: err instanceof Error ? err.message : "识别失败", items: [emptyItem()] }); }
    }
  }

  // 按名称+重量重算这一项。
  async function confirmItem(dishKey: string, item: ItemDraft) {
    const name = item.name.trim();
    if (!name) { updateItem(dishKey, item.key, { state: "error", message: "先填写食物名称" }); return; }
    updateItem(dishKey, item.key, { state: "computing", message: undefined });
    try {
      const grams = Number(item.grams) || 0;
      const a = await callAnalyze(undefined, grams ? `${name}，${grams}克` : name);
      updateItem(dishKey, item.key, {
        state: "ok", calories: a.calories, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g,
        grams: grams ? String(grams) : a.items[0]?.grams ? String(Math.round(a.items[0].grams)) : ""
      });
    } catch (err) { updateItem(dishKey, item.key, { state: "error", message: err instanceof Error ? err.message : "估算失败" }); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dishes.length) { setMessage("请先拍照或手动添加一道菜。"); return; }
    if (allItems.some((i) => i.state === "dirty" || i.state === "error")) { setMessage("还有修改没有确认，请点每项后面的 ✓。"); return; }
    if (dishes.some((d) => !dishName(d))) { setMessage("每道菜至少要有一项食物。"); return; }
    setBusy("save"); setMessage("");
    try {
      const saved: Dish[] = [];
      for (const d of dishes) {
        let image_path = d.image_path;
        if (d.photo && !image_path) {
          image_path = `${userId}/${crypto.randomUUID()}.jpg`;
          const { error } = await supabase.storage.from("meal-photos").upload(image_path, d.photo, { upsert: false, contentType: "image/jpeg" });
          if (error) throw error;
          rememberPhoto("meal-photos", image_path, d.photo);
          updateDish(d.key, { image_path });
        }
        const items: DishItem[] = d.items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), grams: Number(i.grams) || null, calories: round1(i.calories), protein_g: round1(i.protein_g), carbs_g: round1(i.carbs_g), fat_g: round1(i.fat_g) }));
        const t = sum(items);
        saved.push({ name: dishName(d), image_path, items, calories: round1(t.calories), protein_g: round1(t.protein_g), carbs_g: round1(t.carbs_g), fat_g: round1(t.fat_g) });
      }
      const fields = {
        meal_type: mealType, title: (shownTitle.trim() || autoTitle).slice(0, 160), notes: notes.trim() || null,
        dishes: saved, image_path: saved.find((d) => d.image_path)?.image_path ?? null,
        calories: Math.round(totals.calories), protein_g: round1(totals.protein_g), carbs_g: round1(totals.carbs_g), fat_g: round1(totals.fat_g),
        eaten_at: eatenAtFor(date, initial?.eaten_at)
      };
      const query = initial
        ? supabase.from("meal_records").update(fields).eq("id", initial.id)
        : supabase.from("meal_records").insert({ ...fields, user_id: userId });
      const { data, error } = await query.select().single();
      if (error) throw error;
      const kept = new Set(saved.map((d) => d.image_path));
      const removed = draftsFrom(initial, {}).map((d) => d.image_path).filter((p): p is string => !!p && !kept.has(p));
      if (removed.length) await supabase.storage.from("meal-photos").remove(removed);
      onSaved(data as Meal);
    } catch (err) { setMessage(err instanceof Error ? err.message : "保存失败，请稍后重试"); setBusy(""); }
  }

  async function remove() {
    if (!initial || !confirm("确定删除这条饮食记录吗？")) return;
    setBusy("delete");
    const { error } = await supabase.from("meal_records").delete().eq("id", initial.id);
    if (error) { setMessage("删除失败，请稍后重试。"); setBusy(""); return; }
    const paths = draftsFrom(initial, {}).map((d) => d.image_path).filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from("meal-photos").remove(paths);
    onDeleted(initial.id);
  }

  return <div className="modal-backdrop" onClick={onClose}><section className="meal-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">{initial ? "EDIT ENTRY" : "NEW ENTRY"}</span><h2 id="modal-title">{initial ? "编辑这一餐" : "记录一餐"}</h2></div><button className="close-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>
    <form onSubmit={save}>
      <div className="form-row">
        <DateField value={date} onChange={setDate}/>
        <label className="field-label">餐次<select value={mealType} onChange={(e) => setMealType(e.target.value as Meal["meal_type"])}>{Object.entries(mealLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      </div>

      <div className="dish-list">
        {dishes.map((d) => {
          const t = sum(d.items);
          return <div className="dish" key={d.key}>
            <div className="dish-top">
              <button type="button" className="dish-thumb" disabled={!d.preview} onClick={() => d.preview && setViewing(d.preview)} aria-label="查看照片">{d.preview ? <img src={d.preview} alt=""/> : d.image_path ? <Camera size={18}/> : <UtensilsCrossed size={18}/>}</button>
              <div className="dish-summary">
                <strong>{dishName(d) || (d.status === "analyzing" ? "正在识别…" : "未命名")}</strong>
                <small>{Math.round(t.calories)} kcal · 蛋白 {Math.round(t.protein_g)}g · 碳水 {Math.round(t.carbs_g)}g · 脂肪 {Math.round(t.fat_g)}g</small>
              </div>
              <button type="button" className="dish-remove" aria-label="移除这道菜" onClick={() => setDishes((list) => list.filter((x) => x.key !== d.key))}><X size={16}/></button>
            </div>
            {d.status === "analyzing" && <p className="dish-status"><LoaderCircle className="spin" size={14}/> AI 正在识别…</p>}
            {d.status === "error" && <p className="dish-status error">{d.message}，可以手动填写名称和重量后点 ✓</p>}
            {d.items.length > 0 && <div className="item-table">
              <div className="item-head"><span>食物</span><span>重量</span><span>热量</span><span/><span/></div>
              {d.items.map((i) => <div className={`item-row ${i.state}`} key={i.key}>
                <input className="item-name" placeholder="食物名称" value={i.name} onChange={(e) => updateItem(d.key, i.key, { name: e.target.value, state: "dirty" })}/>
                <label className="item-grams"><input type="number" inputMode="decimal" min="0" placeholder="?" value={i.grams} onChange={(e) => updateItem(d.key, i.key, { grams: e.target.value, state: "dirty" })}/><small>g</small></label>
                <span className="item-kcal">{i.state === "dirty" ? "待确认" : i.state === "computing" ? "…" : `${Math.round(i.calories)}`}<small>{i.state === "ok" || i.state === "error" ? " kcal" : ""}</small></span>
                <button type="button" className="item-confirm" aria-label={i.state === "dirty" ? "确认并重新估算" : "已确认"} disabled={i.state === "ok" || i.state === "computing"} onClick={() => confirmItem(d.key, i)}>{i.state === "computing" ? <LoaderCircle className="spin" size={14}/> : <Check size={15}/>}</button>
                {d.items.length > 1 ? <button type="button" className="item-remove" aria-label="删除这一项" onClick={() => updateDish(d.key, (x) => ({ items: x.items.filter((y) => y.key !== i.key) }))}><X size={13}/></button> : <span/>}
                {i.state === "error" && i.message && <p className="item-error">{i.message}</p>}
              </div>)}
            </div>}
            {d.status !== "analyzing" && <button type="button" className="item-add" onClick={() => updateDish(d.key, (x) => ({ items: [...x.items, emptyItem()] }))}><Plus size={13}/> 添加一项</button>}
            {d.confidence && <p className="dish-items">{confidenceLabels[d.confidence]}{d.notes && ` · ${d.notes}`}</p>}
          </div>;
        })}
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }}/>
      <div className="dish-actions">
        <button type="button" onClick={() => fileInput.current?.click()}><Camera size={17}/> 拍照 / 上传</button>
        <button type="button" onClick={() => setDishes((list) => [...list, { key: newKey(), image_path: null, status: "idle", items: [emptyItem()] }])}><PenLine size={17}/> 手动添加</button>
      </div>
      <p className="analysis-disclaimer">{dishes.length ? "名称或重量不对就直接改，再点后面的 ✓，AI 会按新的名称和重量重算。" : "每张照片算一道菜，上传后自动识别；多张照片会合并计算。"}</p>

      {dishes.length > 0 && <div className="meal-total"><span>合计</span><strong>{Math.round(totals.calories)}<small> kcal</small></strong><span>蛋白 {Math.round(totals.protein_g)}g · 碳水 {Math.round(totals.carbs_g)}g · 脂肪 {Math.round(totals.fat_g)}g</span></div>}

      <label className="field-label">餐食名称<input maxLength={160} placeholder="自动用菜名组合，也可以自己写" value={shownTitle} onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}/></label>
      <label className="field-label">备注<textarea rows={2} placeholder="可选，例如：少油、只吃了一半" value={notes} onChange={(e) => setNotes(e.target.value)}/></label>
      {message && <p className="form-message">{message}</p>}
      <button className="primary-button save-button" disabled={!!busy || working}>{busy === "save" ? "正在保存…" : working ? "等待 AI 计算完成…" : initial ? "保存修改" : "保存饮食记录"}</button>
      {initial && <button type="button" className="delete-button" disabled={!!busy} onClick={remove}><Trash2 size={15}/> {busy === "delete" ? "正在删除…" : "删除这条记录"}</button>}
    </form>
    {viewing && <PhotoViewer src={viewing} onClose={() => setViewing("")}/>}
  </section></div>;
}
