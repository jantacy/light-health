"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Camera, LoaderCircle, PenLine, Sparkles, Trash2, UtensilsCrossed, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { rememberPhoto } from "@/lib/photo-cache";
import { todayISO } from "@/lib/date";
import type { Dish, Meal } from "@/lib/types";
import type { FoodAnalysis, FoodItem } from "@/lib/vision/types";
import DateField from "./date-field";
import PhotoViewer from "./photo-viewer";

export const mealLabels: Record<Meal["meal_type"], string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const confidenceLabels = { high: "把握较高", medium: "把握一般", low: "把握较低" };
const nutrientFields = [["calories", "热量"], ["protein_g", "蛋白"], ["carbs_g", "碳水"], ["fat_g", "脂肪"]] as const;
type NutrientKey = (typeof nutrientFields)[number][0];

// 一餐由若干菜品组成：每张照片一道菜（上传后自动识别），也可以只写菜名让 AI 估算。
type DishDraft = Record<NutrientKey, string> & {
  key: string;
  name: string;
  photo?: File;
  preview?: string;
  image_path: string | null;
  status: "idle" | "analyzing" | "error";
  message?: string;
  estimatedName?: string;
  items?: FoodItem[];
  confidence?: FoodAnalysis["confidence"];
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

const num = (v: string) => Number(v || 0);
const str = (v: number) => (v ? String(Math.round(v * 10) / 10) : "");
let seq = 0;
const newKey = () => `d${Date.now()}-${seq++}`;

function draftsFrom(meal: Meal | undefined, photoUrls: Record<string, string>): DishDraft[] {
  if (!meal) return [];
  const dishes: Dish[] = meal.dishes?.length ? meal.dishes
    : [{ name: meal.title, calories: meal.calories, protein_g: meal.protein_g, carbs_g: meal.carbs_g, fat_g: meal.fat_g, image_path: meal.image_path }];
  return dishes.map((d) => ({
    key: newKey(), name: d.name, estimatedName: d.name, image_path: d.image_path, status: "idle",
    preview: d.image_path ? photoUrls[d.image_path] : undefined,
    calories: str(Number(d.calories)), protein_g: str(Number(d.protein_g)), carbs_g: str(Number(d.carbs_g)), fat_g: str(Number(d.fat_g))
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

  const update = (key: string, patch: Partial<DishDraft>) => setDishes((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const totals = dishes.reduce((t, d) => ({ calories: t.calories + num(d.calories), protein_g: t.protein_g + num(d.protein_g), carbs_g: t.carbs_g + num(d.carbs_g), fat_g: t.fat_g + num(d.fat_g) }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const autoTitle = dishes.map((d) => d.name.trim()).filter(Boolean).join("、").slice(0, 160);
  const shownTitle = titleTouched ? title : autoTitle;
  const analyzing = dishes.some((d) => d.status === "analyzing");

  async function estimate(key: string, photo: File | undefined, hint: string | undefined) {
    update(key, { status: "analyzing", message: undefined });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("登录状态已失效，请重新登录。");
      const body = new FormData();
      if (photo) body.append("image", photo);
      if (hint) body.append("hint", hint);
      const response = await fetch("/api/analyze", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body });
      const a = await response.json().catch(() => ({ error: "识图服务暂时不可用，请稍后重试或手动填写。" }));
      if (!response.ok) throw new Error(a.error || "识别暂不可用");
      const name = hint || a.title;
      update(key, {
        status: "idle", name, estimatedName: name, items: a.items, confidence: a.confidence,
        calories: str(Math.round(a.calories)), protein_g: str(a.protein_g), carbs_g: str(a.carbs_g), fat_g: str(a.fat_g)
      });
    } catch (err) { update(key, { status: "error", message: err instanceof Error ? err.message : "识别暂不可用" }); }
  }

  async function addPhotos(files: FileList | null) {
    for (const file of Array.from(files || [])) {
      const key = newKey();
      setDishes((list) => [...list, { key, name: "", image_path: null, status: "analyzing", calories: "", protein_g: "", carbs_g: "", fat_g: "" }]);
      compressImage(file)
        .then((photo) => { update(key, { photo, preview: URL.createObjectURL(photo) }); return estimate(key, photo, undefined); })
        .catch((err) => update(key, { status: "error", message: err instanceof Error ? err.message : "无法读取这张图片" }));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dishes.length) { setMessage("请先拍照或手动添加一道菜。"); return; }
    if (dishes.some((d) => !d.name.trim())) { setMessage("还有菜品没有名称。"); return; }
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
          update(d.key, { image_path });
        }
        saved.push({ name: d.name.trim(), calories: num(d.calories), protein_g: num(d.protein_g), carbs_g: num(d.carbs_g), fat_g: num(d.fat_g), image_path });
      }
      const fields = {
        meal_type: mealType, title: (shownTitle.trim() || autoTitle).slice(0, 160), notes: notes.trim() || null,
        dishes: saved, image_path: saved.find((d) => d.image_path)?.image_path ?? null,
        calories: Math.round(totals.calories), protein_g: totals.protein_g, carbs_g: totals.carbs_g, fat_g: totals.fat_g,
        eaten_at: eatenAtFor(date, initial?.eaten_at)
      };
      const query = initial
        ? supabase.from("meal_records").update(fields).eq("id", initial.id)
        : supabase.from("meal_records").insert({ ...fields, user_id: userId });
      const { data, error } = await query.select().single();
      if (error) throw error;
      const kept = new Set(saved.map((d) => d.image_path));
      const removed = (initial ? draftsFrom(initial, {}) : []).map((d) => d.image_path).filter((p): p is string => !!p && !kept.has(p));
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
        {dishes.map((d) => <div className="dish" key={d.key}>
          <div className="dish-top">
            <button type="button" className="dish-thumb" disabled={!d.preview} onClick={() => d.preview && setViewing(d.preview)} aria-label="查看照片">{d.preview ? <img src={d.preview} alt=""/> : d.image_path ? <Camera size={18}/> : <UtensilsCrossed size={18}/>}</button>
            <input className="dish-name" placeholder={d.status === "analyzing" ? "正在识别…" : "菜名，可写份量，如：牛肉面 大碗"} value={d.name} onChange={(e) => update(d.key, { name: e.target.value })}/>
            <button type="button" className="dish-remove" aria-label="移除这道菜" onClick={() => setDishes((list) => list.filter((x) => x.key !== d.key))}><X size={16}/></button>
          </div>
          {d.status === "analyzing" && <p className="dish-status"><LoaderCircle className="spin" size={14}/> AI 正在估算…</p>}
          {d.status === "error" && <p className="dish-status error">{d.message}</p>}
          {d.status !== "analyzing" && d.name.trim() && d.name.trim() !== d.estimatedName && <button type="button" className="dish-estimate" onClick={() => estimate(d.key, d.photo, d.name.trim())}><Sparkles size={14}/> 按这个名称重新估算</button>}
          {d.status === "idle" && d.items && d.items.length > 0 && <p className="dish-items">{d.items.map((i) => `${i.name}${i.portion ? ` ${i.portion}` : ""} ${Math.round(i.calories)}`).join(" · ")}{d.confidence && ` · ${confidenceLabels[d.confidence]}`}</p>}
          <div className="dish-nums">{nutrientFields.map(([k, label]) => <label key={k}><small>{label}</small><input type="number" inputMode="decimal" min="0" step="0.1" placeholder="0" value={d[k]} onChange={(e) => update(d.key, { [k]: e.target.value })}/></label>)}</div>
        </div>)}
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }}/>
      <div className="dish-actions">
        <button type="button" onClick={() => fileInput.current?.click()}><Camera size={17}/> 拍照 / 上传</button>
        <button type="button" onClick={() => setDishes((list) => [...list, { key: newKey(), name: "", image_path: null, status: "idle", calories: "", protein_g: "", carbs_g: "", fat_g: "" }])}><PenLine size={17}/> 手动添加</button>
      </div>
      <p className="analysis-disclaimer">{dishes.length ? "AI 估算有误差：菜名不对就改名后重新估算，数字也可以直接改。" : "每张照片算一道菜，上传后自动识别；多张照片会合并计算。"}</p>

      {dishes.length > 0 && <div className="meal-total"><span>合计</span><strong>{Math.round(totals.calories)}<small> kcal</small></strong><span>蛋白 {Math.round(totals.protein_g)}g · 碳水 {Math.round(totals.carbs_g)}g · 脂肪 {Math.round(totals.fat_g)}g</span></div>}

      <label className="field-label">餐食名称<input maxLength={160} placeholder="自动用菜名组合，也可以自己写" value={shownTitle} onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}/></label>
      <label className="field-label">备注<textarea rows={2} placeholder="可选，例如：少油、只吃了一半" value={notes} onChange={(e) => setNotes(e.target.value)}/></label>
      {message && <p className="form-message">{message}</p>}
      <button className="primary-button save-button" disabled={!!busy || analyzing}>{busy === "save" ? "正在保存…" : analyzing ? "等待识别完成…" : initial ? "保存修改" : "保存饮食记录"}</button>
      {initial && <button type="button" className="delete-button" disabled={!!busy} onClick={remove}><Trash2 size={15}/> {busy === "delete" ? "正在删除…" : "删除这条记录"}</button>}
    </form>
    {viewing && <PhotoViewer src={viewing} onClose={() => setViewing("")}/>}
  </section></div>;
}
