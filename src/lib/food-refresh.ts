import { createAdminClient } from "@/lib/supabase/admin";
import { getVisionProvider } from "@/lib/vision";

// 定时处理被标记 needs_refresh 的食物：让 AI 按“名称，100克”重估，新旧数值各取一半，避免单次估算偏差带来大幅跳动。
// claim_food_refresh 用 skip locked 认领，server1 和 server2 同时运行也不会重复处理。
const INTERVAL = 30 * 60 * 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

async function refreshOnce() {
  const provider = getVisionProvider();
  if (!provider) return;
  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("claim_food_refresh", { max_rows: 10 });
  if (error) { console.error("[food-refresh] claim", error.message); return; }
  for (const row of rows ?? []) {
    try {
      const a = await provider.analyze({ hint: `${row.display_name}，100克` });
      const mix = (oldV: number, newV: number) => r1((Number(oldV) + newV) / 2);
      await admin.from("food_library").update({
        calories_100g: mix(row.calories_100g, a.calories), protein_100g: mix(row.protein_100g, a.protein_g),
        carbs_100g: mix(row.carbs_100g, a.carbs_g), fat_100g: mix(row.fat_100g, a.fat_g),
        refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("name", row.name);
      console.log(`[food-refresh] ${row.display_name}: ${row.calories_100g} → ${mix(row.calories_100g, a.calories)} kcal/100g`);
    } catch (err) {
      console.error("[food-refresh]", row.display_name, err instanceof Error ? err.message : err);
      await admin.from("food_library").update({ needs_refresh: true }).eq("name", row.name); // 失败放回队列，下次再试
    }
  }
}

let started = false;
export function startFoodRefresh() {
  if (started || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  started = true;
  setTimeout(() => { refreshOnce(); setInterval(refreshOnce, INTERVAL); }, 60 * 1000);
}
