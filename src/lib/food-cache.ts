import { foodKey } from "@/lib/food-names";

// 本地食物库：确认过的食物按“每 100 克的营养”存在本机，换算重量或再次输入同名食物时不用联网。
// 7 天后过期，重新从服务端食物库取（服务端会定期重估常用食物）。
export type Per100 = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
export type Nutrients = Per100;

const KEY = "light-meal:foods";
const MAX = 300;
const TTL = 7 * 86400000;
const norm = foodKey; // 与服务端食物库同一套键

function read(): Record<string, Per100 & { t: number }> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

export function rememberFood(name: string, grams: number, n: Nutrients) {
  if (!name.trim() || !(grams > 0)) return;
  const all = read();
  const f = 100 / grams;
  all[norm(name)] = { calories: n.calories * f, protein_g: n.protein_g * f, carbs_g: n.carbs_g * f, fat_g: n.fat_g * f, t: Date.now() };
  const entries = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
}

export function lookupFood(name: string): Per100 | null {
  const hit = read()[norm(name)];
  return hit && Date.now() - hit.t < TTL ? hit : null;
}

export const scale = (per100: Per100, grams: number): Nutrients => {
  const f = grams / 100;
  return { calories: per100.calories * f, protein_g: per100.protein_g * f, carbs_g: per100.carbs_g * f, fat_g: per100.fat_g * f };
};
