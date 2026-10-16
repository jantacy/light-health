import { createAdminClient } from "@/lib/supabase/admin";

// 服务端共享食物库（每 100 克营养）。只在服务端用 service role 访问。
export type Nutrients = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
type Row = { name: string; display_name: string; calories_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number };

export const normName = (name: string) => name.replace(/\s+/g, "").toLowerCase();
const r1 = (v: number) => Math.round(v * 10) / 10;

export function fromPer100(row: Row, grams: number): Nutrients {
  const f = grams / 100;
  return { calories: r1(row.calories_100g * f), protein_g: r1(row.protein_100g * f), carbs_g: r1(row.carbs_100g * f), fat_g: r1(row.fat_100g * f) };
}

export async function lookupFoods(names: string[]): Promise<Map<string, Row>> {
  const keys = [...new Set(names.map(normName).filter(Boolean))];
  if (!keys.length) return new Map();
  try {
    const { data } = await createAdminClient().from("food_library").select("name, display_name, calories_100g, protein_100g, carbs_100g, fat_100g").in("name", keys);
    return new Map((data ?? []).map((row) => [row.name, row as Row]));
  } catch { return new Map(); }
}

// 只新增不覆盖：同名食物以第一次入库的数值为准，保证前后一致。
export async function saveFoods(foods: { name: string; grams: number; n: Nutrients }[], source: "ai" | "photo") {
  const rows = foods.filter((f) => f.name.trim() && f.grams > 0 && f.n.calories >= 0).map((f) => {
    const k = 100 / f.grams;
    return { name: normName(f.name), display_name: f.name.trim().slice(0, 60), calories_100g: r1(f.n.calories * k), protein_100g: r1(f.n.protein_g * k), carbs_100g: r1(f.n.carbs_g * k), fat_100g: r1(f.n.fat_g * k), source };
  });
  if (!rows.length) return;
  const unique = [...new Map(rows.map((r) => [r.name, r])).values()];
  const { error } = await createAdminClient().from("food_library").upsert(unique, { onConflict: "name", ignoreDuplicates: true });
  if (error) console.error("[food_library]", error.message);
}
