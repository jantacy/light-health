"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LoaderCircle, Sparkles, Trash2, Upload, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { todayISO } from "@/lib/date";
import type { Meal } from "@/lib/types";
import type { FoodAnalysis } from "@/lib/vision/types";

export const mealLabels: Record<Meal["meal_type"], string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const confidenceLabels = { high: "把握较高", medium: "把握一般", low: "把握较低" };

function guessMealType(): Meal["meal_type"] {
  const hour = new Date().getHours();
  return hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
}

// 非今天补记时，用所选日期 + 当前时刻，保证记录落在那一天。
function eatenAtFor(date: string) {
  if (date === todayISO()) return new Date().toISOString();
  const now = new Date();
  const d = new Date(`${date}T00:00:00`);
  d.setHours(now.getHours(), now.getMinutes());
  return d.toISOString();
}

type Props = {
  supabase: SupabaseClient;
  userId: string;
  date: string;
  initial?: Meal;
  initialImageUrl?: string;
  onSaved: (meal: Meal) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
};

export default function MealModal({ supabase, userId, date, initial, initialImageUrl, onSaved, onDeleted, onClose }: Props) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    meal_type: initial?.meal_type ?? guessMealType(),
    calories: initial ? String(initial.calories) : "",
    protein_g: initial ? String(initial.protein_g) : "",
    carbs_g: initial ? String(initial.carbs_g) : "",
    fat_g: initial ? String(initial.fat_g) : "",
    notes: initial?.notes ?? ""
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState(initialImageUrl ?? "");
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);
  const [busy, setBusy] = useState<"" | "photo" | "analyze" | "save" | "delete">("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });

  async function choosePhoto(file?: File) {
    if (!file) return;
    setBusy("photo"); setMessage(""); setAnalysis(null);
    try {
      const compressed = await compressImage(file);
      setPhoto(compressed); setPreview(URL.createObjectURL(compressed));
    } catch (err) { setMessage(err instanceof Error ? err.message : "无法读取这张图片"); }
    finally { setBusy(""); }
  }

  async function analyzePhoto() {
    if (!photo) return;
    setBusy("analyze"); setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("登录状态已失效，请重新登录。");
      const body = new FormData(); body.append("image", photo);
      const response = await fetch("/api/analyze", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body });
      const result = await response.json().catch(() => ({ error: "识图服务暂时不可用，请稍后重试或手动填写。" }));
      if (!response.ok) throw new Error(result.error || "识别暂不可用");
      const a = result as FoodAnalysis;
      setAnalysis(a);
      setForm((v) => ({
        ...v, title: a.title, calories: String(Math.round(a.calories)), protein_g: String(a.protein_g), carbs_g: String(a.carbs_g), fat_g: String(a.fat_g),
        notes: a.items.length ? a.items.map((i) => `${i.name}${i.portion ? ` ${i.portion}` : ""} ${Math.round(i.calories)}kcal`).join("；") : v.notes
      }));
    } catch (err) { setMessage(err instanceof Error ? err.message : "识别暂不可用"); }
    finally { setBusy(""); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save"); setMessage("");
    try {
      let image_path = initial?.image_path ?? null;
      if (photo) {
        image_path = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("meal-photos").upload(image_path, photo, { upsert: false, contentType: "image/jpeg" });
        if (error) throw error;
      }
      const fields = {
        meal_type: form.meal_type, title: form.title.trim(), image_path,
        calories: Number(form.calories || 0), protein_g: Number(form.protein_g || 0), carbs_g: Number(form.carbs_g || 0), fat_g: Number(form.fat_g || 0),
        notes: form.notes.trim() || null
      };
      const query = initial
        ? supabase.from("meal_records").update(fields).eq("id", initial.id)
        : supabase.from("meal_records").insert({ ...fields, user_id: userId, eaten_at: eatenAtFor(date) });
      const { data, error } = await query.select().single();
      if (error) throw error;
      if (photo && initial?.image_path) await supabase.storage.from("meal-photos").remove([initial.image_path]);
      onSaved(data as Meal);
    } catch (err) { setMessage(err instanceof Error ? err.message : "保存失败，请检查 Supabase 配置"); setBusy(""); }
  }

  async function remove() {
    if (!initial || !confirm("确定删除这条饮食记录吗？")) return;
    setBusy("delete");
    const { error } = await supabase.from("meal_records").delete().eq("id", initial.id);
    if (error) { setMessage("删除失败，请稍后重试。"); setBusy(""); return; }
    if (initial.image_path) await supabase.storage.from("meal-photos").remove([initial.image_path]);
    onDeleted(initial.id);
  }

  return <div className="modal-backdrop" onClick={onClose}><section className="meal-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">{initial ? "EDIT ENTRY" : "NEW ENTRY"}</span><h2 id="modal-title">{initial ? "编辑这一餐" : "记录一餐"}</h2></div><button className="close-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>
    <form onSubmit={save}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { choosePhoto(e.target.files?.[0]); e.target.value = ""; }}/>
      <button type="button" className={`upload-area ${preview ? "has-image" : ""}`} onClick={() => fileInput.current?.click()} disabled={busy === "photo"}>{busy === "photo" ? <LoaderCircle className="spin" size={20}/> : preview ? <img src={preview} alt="饮食照片预览"/> : <><span className="upload-icon"><Upload size={20}/></span><strong>拍照或上传照片</strong><small>支持 JPG、PNG、HEIC</small></>}</button>
      {photo && <button type="button" className="analyze-button" disabled={!!busy} onClick={analyzePhoto}>{busy === "analyze" ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy === "analyze" ? "正在识别…" : "AI 估算营养"} <span>可手动修改</span></button>}
      {analysis && <div className="analysis-card"><div className="analysis-head"><span className="ai-badge">AI 估算</span><small>{confidenceLabels[analysis.confidence]}</small></div>{analysis.items.length > 0 && <ul>{analysis.items.map((item, i) => <li key={i}><span>{item.name}{item.portion && <small> {item.portion}</small>}</span><b>{Math.round(item.calories)} kcal</b></li>)}</ul>}{analysis.notes && <p>{analysis.notes}</p>}<p className="analysis-disclaimer">照片估算存在误差，份量、酱料和用油请按实际修改。</p></div>}
      {message && <p className="form-message">{message}</p>}
      <label className="field-label">餐食名称<input required maxLength={160} placeholder="例如：鸡胸肉藜麦沙拉" value={form.title} onChange={set("title")}/></label>
      <label className="field-label">餐次<select value={form.meal_type} onChange={set("meal_type")}>{Object.entries(mealLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <div className="nutrition-fields">
        <label className="field-label">热量 kcal<input type="number" inputMode="decimal" min="0" step="1" placeholder="0" value={form.calories} onChange={set("calories")}/></label>
        <label className="field-label">蛋白质 g<input type="number" inputMode="decimal" min="0" step="0.1" placeholder="0" value={form.protein_g} onChange={set("protein_g")}/></label>
        <label className="field-label">碳水 g<input type="number" inputMode="decimal" min="0" step="0.1" placeholder="0" value={form.carbs_g} onChange={set("carbs_g")}/></label>
        <label className="field-label">脂肪 g<input type="number" inputMode="decimal" min="0" step="0.1" placeholder="0" value={form.fat_g} onChange={set("fat_g")}/></label>
      </div>
      <label className="field-label">备注<textarea rows={2} placeholder="可选，例如：少油、只吃了一半" value={form.notes} onChange={set("notes")}/></label>
      <button className="primary-button save-button" disabled={!!busy}>{busy === "save" ? "正在保存…" : initial ? "保存修改" : "保存饮食记录"}</button>
      {initial && <button type="button" className="delete-button" disabled={!!busy} onClick={remove}><Trash2 size={15}/> {busy === "delete" ? "正在删除…" : "删除这条记录"}</button>}
    </form>
  </section></div>;
}
