"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Camera, LoaderCircle, LogOut, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { rememberPhoto } from "@/lib/photo-cache";
import Avatar from "./avatar";

export type Profile = { phone: string; nickname: string | null; gender: "male" | "female" | null; birth_month: number | null; birth_day: number | null; avatar_path: string | null; calorie_goal: number | null; target_weight: number | null };

// 星座按公历日期推算：[名称, 该星座在当月的起始日]，按月份索引（1 月从水瓶座 1/20 开始）。
const signs: [string, number][] = [["摩羯座", 1], ["水瓶座", 20], ["双鱼座", 19], ["白羊座", 21], ["金牛座", 20], ["双子座", 21], ["巨蟹座", 22], ["狮子座", 23], ["处女座", 23], ["天秤座", 23], ["天蝎座", 24], ["射手座", 23], ["摩羯座", 22]];
export function zodiac(month: number | null, day: number | null) {
  if (!month || !day) return "";
  return day >= signs[month][1] ? signs[month][0] : signs[month - 1][0];
}
const daysIn = (month: number) => new Date(2024, month, 0).getDate(); // 2024 是闰年，2 月可选 29 日
const displayPhone = (p: string) => (p.startsWith("+86") ? p.slice(3) : p);

type Props = {
  supabase: SupabaseClient;
  userId: string;
  initial: Profile | null;
  avatarUrl: string;
  onClose: () => void;
  onSaved: (p: Profile) => void;
  onAvatarChanged: (p: Profile, url: string) => void;
};

export default function SettingsModal({ supabase, userId, initial, avatarUrl, onClose, onSaved, onAvatarChanged }: Props) {
  const [profile, setProfile] = useState<Profile | null>(initial);
  const [message, setMessage] = useState("");
  useEffect(() => { if (initial && !profile) setProfile(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // 换头像：压缩到 512px 上传到自己的目录，写入资料后删掉旧图。
  async function changeAvatar(file?: File) {
    if (!file || !profile) return;
    setUploading(true); setMessage("");
    try {
      const photo = await compressImage(file, 512, 0.88);
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, photo, { contentType: "image/jpeg" });
      if (error) throw error;
      rememberPhoto("avatars", path, photo);
      const { error: updateError } = await supabase.from("user_profiles").update({ avatar_path: path, updated_at: new Date().toISOString() }).eq("phone", profile.phone);
      if (updateError) throw updateError;
      if (profile.avatar_path) await supabase.storage.from("avatars").remove([profile.avatar_path]);
      const next = { ...profile, avatar_path: path };
      setProfile(next);
      onAvatarChanged(next, URL.createObjectURL(photo));
    } catch { setMessage("头像上传失败，请稍后重试。"); }
    finally { setUploading(false); }
  }

  const set = (patch: Partial<Profile>) => setProfile((p) => (p ? { ...p, ...patch } : p));

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!profile) return;
    if (profile.calorie_goal !== null && !(profile.calorie_goal >= 800 && profile.calorie_goal <= 5000)) { setMessage("热量阈值请填 800–5000 之间的数。"); return; }
    if (profile.target_weight !== null && !(profile.target_weight >= 25 && profile.target_weight <= 300)) { setMessage("目标体重请填 25–300 kg 之间的数。"); return; }
    setSaving(true); setMessage("");
    const day = profile.birth_month && profile.birth_day ? Math.min(profile.birth_day, daysIn(profile.birth_month)) : profile.birth_day;
    const fields = { nickname: profile.nickname?.trim() || null, gender: profile.gender, birth_month: profile.birth_month, birth_day: day, calorie_goal: profile.calorie_goal, target_weight: profile.target_weight === null ? null : Math.round(profile.target_weight * 10) / 10, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("user_profiles").update(fields).eq("phone", profile.phone);
    setSaving(false);
    if (error) setMessage("保存失败，请稍后重试。"); else onSaved({ ...profile, ...fields });
  }

  return <div className="modal-backdrop" onClick={onClose}><section className="meal-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">SETTINGS</span><h2 id="settings-title">设置</h2></div><button className="close-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>
    {!profile ? <p className="form-message">{message || "正在读取…"}</p> : <form onSubmit={save}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { changeAvatar(e.target.files?.[0]); e.target.value = ""; }}/>
      <button type="button" className="avatar-edit" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="更换头像">
        <Avatar src={avatarUrl} name={profile.nickname} size={84}/>
        <span>{uploading ? <LoaderCircle className="spin" size={14}/> : <Camera size={14}/>}</span>
      </button>
      <p className="avatar-hint">点头像更换</p>
      <label className="field-label">手机号<input value={displayPhone(profile.phone)} readOnly disabled/></label>
      <label className="field-label">昵称<input maxLength={30} placeholder="怎么称呼你" value={profile.nickname ?? ""} onChange={(e) => set({ nickname: e.target.value })}/></label>
      <div className="field-label">性别<div className="segmented gender-switch">{([["female", "女"], ["male", "男"]] as const).map(([v, label]) => <button type="button" key={v} className={profile.gender === v ? "active" : ""} onClick={() => set({ gender: v })}>{label}</button>)}</div></div>
      <div className="form-row">
        <label className="field-label">生日（月）<select value={profile.birth_month ?? ""} onChange={(e) => set({ birth_month: e.target.value ? Number(e.target.value) : null })}><option value="">未设置</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 月</option>)}</select></label>
        <label className="field-label">生日（日）<select value={profile.birth_day ?? ""} onChange={(e) => set({ birth_day: e.target.value ? Number(e.target.value) : null })}><option value="">未设置</option>{Array.from({ length: daysIn(profile.birth_month || 1) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 日</option>)}</select></label>
      </div>
      <div className="form-row">
        <label className="field-label">热量阈值（kcal/天）<input type="number" inputMode="numeric" min={800} max={5000} step={50} placeholder="2000" value={profile.calorie_goal ?? ""} onChange={(e) => set({ calorie_goal: e.target.value ? Number(e.target.value) : null })}/></label>
        <label className="field-label">目标体重（kg）<input type="number" inputMode="decimal" min={25} max={300} step={0.1} placeholder="未设置" value={profile.target_weight ?? ""} onChange={(e) => set({ target_weight: e.target.value ? Number(e.target.value) : null })}/></label>
      </div>
      <label className="field-label">星座<input value={zodiac(profile.birth_month, profile.birth_day) || "设置生日后自动生成"} readOnly disabled/></label>
      {message && <p className="form-message">{message}</p>}
      <button className="primary-button save-button" disabled={saving}>{saving ? "正在保存…" : "保存"}</button>
    </form>}
    <button type="button" className="delete-button" onClick={() => supabase.auth.signOut()}><LogOut size={15}/> 退出登录</button>
  </section></div>;
}
