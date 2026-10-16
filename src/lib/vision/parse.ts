import type { FoodAnalysis, FoodItem } from "./types";

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10) / 10 : null;
}

// 模型偶尔会用 ```json 包裹或在 JSON 前后加说明，这里只取第一个完整对象。
function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(content.slice(start, end + 1)); } catch { return null; }
}

export function parseAnalysis(content: string, provider: string, model: string): FoodAnalysis | null {
  const result = extractJson(content) as Record<string, unknown> | null;
  if (!result || typeof result !== "object") return null;
  const calories = numberValue(result.calories);
  const protein_g = numberValue(result.protein_g);
  const carbs_g = numberValue(result.carbs_g);
  const fat_g = numberValue(result.fat_g);
  if (typeof result.title !== "string" || !result.title.trim() || calories === null || protein_g === null || carbs_g === null || fat_g === null) return null;

  const items: FoodItem[] = Array.isArray(result.items)
    ? result.items.flatMap((raw) => {
        const item = raw as Record<string, unknown>;
        const itemCalories = numberValue(item?.calories);
        if (typeof item?.name !== "string" || itemCalories === null) return [];
        // 兼容旧格式 portion: "约200g"
        const grams = numberValue(item.grams) ?? numberValue(String(item.portion ?? "").match(/(\d+(?:\.\d+)?)\s*(?:g|克)/i)?.[1]) ?? 0;
        return [{ name: item.name.trim().slice(0, 60), grams, calories: itemCalories, protein_g: numberValue(item.protein_g) ?? 0, carbs_g: numberValue(item.carbs_g) ?? 0, fat_g: numberValue(item.fat_g) ?? 0 }];
      }).slice(0, 12)
    : [];
  const confidence = result.confidence === "high" || result.confidence === "low" ? result.confidence : "medium";

  return {
    title: result.title.trim().slice(0, 160),
    calories, protein_g, carbs_g, fat_g, items, confidence,
    notes: typeof result.notes === "string" ? result.notes.trim().slice(0, 200) : "",
    provider, model
  };
}
