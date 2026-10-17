import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dayRange, localDay, todayISO } from "@/lib/date";
import type { Meal, WeightEntry } from "@/lib/types";

// 趋势页的本地数据：最近 90 天每天的热量、蛋白质和体重。趋势页只读这里，不等网络。
// 只在本地不完整时（新设备、超出已覆盖的范围）或用户下拉刷新时，才从服务端一次拉取 90 天。
// 首页每次加载某一天，都会顺带更新那天的汇总（见 recordDay），所以本机的新增、修改、删除会实时反映。
export const TREND_DAYS = 90;
export type DayTotal = { calories: number; protein: number };
export type TrendStore = {
  firstDay: string | null | undefined; // 用户最早有记录的那天；null = 还没有任何记录；undefined = 还没查过
  from: string | null;                 // 从这天到今天，本地数据是完整的
  days: Record<string, DayTotal>;
  weights: Record<string, number>;
};

const key = (userId: string) => `light-meal:trend-store:${userId}`;
const empty = (): TrendStore => ({ firstDay: undefined, from: null, days: {}, weights: {} });

export function readTrendStore(userId: string): TrendStore {
  try { for (const r of [7, 30, 90]) localStorage.removeItem(`light-meal:trends:${userId}:${r}`); } catch {} // 上一版按范围分开的缓存
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(key(userId)) || "{}") }; } catch { return empty(); }
}

function write(userId: string, store: TrendStore) {
  const oldest = addDays(todayISO(), -(TREND_DAYS - 1));
  const keep = <T,>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([d]) => d >= oldest));
  try { localStorage.setItem(key(userId), JSON.stringify({ ...store, days: keep(store.days), weights: keep(store.weights) })); } catch {}
}

const earlier = (a: string | null | undefined, b: string) => (a ? (a < b ? a : b) : b);

// 首页加载某一天成功后调用：用那天的记录（含还没同步的本地修改）更新汇总。
export function recordDay(userId: string, date: string, meals: Meal[], weights: WeightEntry[]) {
  const store = readTrendStore(userId);
  const calories = meals.reduce((s, m) => s + Number(m.calories), 0), protein = meals.reduce((s, m) => s + Number(m.protein_g), 0);
  if (meals.length) store.days[date] = { calories, protein }; else delete store.days[date];
  const w = weights.find((x) => x.recorded_on === date);
  if (w) store.weights[date] = Number(w.weight_kg); else delete store.weights[date];
  if ((meals.length || w) && store.firstDay !== undefined) store.firstDay = earlier(store.firstDay, date);
  write(userId, store);
}

// 本地是否已经覆盖 range 天：需要的起点 = max(range 天前, 首次记录日)。
function covered(store: TrendStore, range: number) {
  if (store.firstDay === undefined) return false;
  if (store.firstDay === null) return true; // 没有任何记录
  const windowStart = addDays(todayISO(), -(range - 1));
  const need = store.firstDay > windowStart ? store.firstDay : windowStart;
  return !!store.from && store.from <= need;
}

// 需要时从服务端拉取 90 天（force：下拉刷新）。返回更新后的数据；网络失败返回 null，保留本地数据。
export async function syncTrends(supabase: SupabaseClient, userId: string, range: number, force = false): Promise<TrendStore | null> {
  let store = readTrendStore(userId);
  if (!force && covered(store, range)) return store;
  if (force || store.firstDay === undefined) {
    const [m, w] = await Promise.all([
      supabase.from("meal_records").select("eaten_at").order("eaten_at").limit(1),
      supabase.from("weight_records").select("recorded_on").order("recorded_on").limit(1)
    ]);
    if (m.error || w.error) return null;
    const first = [m.data?.[0] ? localDay(m.data[0].eaten_at) : null, w.data?.[0]?.recorded_on ?? null].filter((d): d is string => !!d).sort()[0] ?? null;
    store = { ...store, firstDay: first };
    if (!force && covered(store, range)) { write(userId, store); return store; }
  }
  const from = addDays(todayISO(), -(TREND_DAYS - 1));
  const [m, w] = await Promise.all([
    supabase.from("meal_records").select("eaten_at, calories, protein_g").gte("eaten_at", dayRange(from).start),
    supabase.from("weight_records").select("recorded_on, weight_kg").gte("recorded_on", from)
  ]);
  if (m.error || w.error) return null;
  const days: Record<string, DayTotal> = {};
  for (const r of m.data ?? []) {
    const d = localDay(r.eaten_at), v = days[d] ?? { calories: 0, protein: 0 };
    v.calories += Number(r.calories); v.protein += Number(r.protein_g); days[d] = v;
  }
  const weights = Object.fromEntries((w.data ?? []).map((r) => [r.recorded_on, Number(r.weight_kg)]));
  store = { ...store, from, days, weights };
  write(userId, store);
  return store;
}
