import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meal } from "@/lib/types";
import { cachedPhoto } from "@/lib/photo-cache";

// 饮食记录的待同步队列：保存/删除先改本地并立即显示，再由后台上传照片、写数据库。
// 队列存在 localStorage（照片本身在 Cache Storage 里），关掉 App 也不会丢；失败的任务稍后重试。
// 新记录在本地生成 id，照片和记录都用 upsert，重复执行是安全的。
export type MealRow = Omit<Meal, "dishes"> & { user_id: string; dishes: Meal["dishes"] };
export type Job = { id: string; kind: "save" | "delete"; row?: MealRow; upload: string[]; remove: string[]; tries: number };

const keyOf = (userId: string) => `light-meal:outbox:${userId}`;
const listeners = new Set<() => void>();
let running = false;

export function readJobs(userId: string): Job[] {
  try { return JSON.parse(localStorage.getItem(keyOf(userId)) || "[]"); } catch { return []; }
}
function writeJobs(userId: string, jobs: Job[]) {
  try { localStorage.setItem(keyOf(userId), JSON.stringify(jobs)); } catch {}
  listeners.forEach((fn) => fn());
}
export function onOutboxChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// 同一条记录只保留一个任务：新任务覆盖旧任务，但要上传/删除的照片合并。
export function enqueue(userId: string, job: Omit<Job, "tries">) {
  const jobs = readJobs(userId);
  const prev = jobs.find((j) => j.id === job.id);
  const remove = [...new Set([...(prev?.remove ?? []), ...job.remove])];
  const upload = job.kind === "delete" ? [] : [...new Set([...(prev?.upload ?? []), ...job.upload])].filter((p) => !remove.includes(p));
  // 删除一条还没同步上去的新记录：直接丢掉任务，只清理已上传的照片
  const next: Job = { ...job, upload, remove: job.kind === "delete" ? [...new Set([...remove, ...(prev?.upload ?? [])])] : remove, tries: 0 };
  writeJobs(userId, [...jobs.filter((j) => j.id !== job.id), next]);
}

export async function flush(supabase: SupabaseClient, userId: string): Promise<boolean> {
  if (running) return false;
  running = true;
  let changed = false;
  try {
    for (const job of readJobs(userId)) {
      try {
        for (const path of job.upload) {
          const blob = await cachedPhoto("meal-photos", path);
          if (!blob) continue; // 本地照片已丢失：跳过，记录照常保存
          const { error } = await supabase.storage.from("meal-photos").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
          if (error) throw error;
        }
        if (job.kind === "save" && job.row) {
          const { error } = await supabase.from("meal_records").upsert(job.row, { onConflict: "id" });
          if (error) throw error;
        } else if (job.kind === "delete") {
          const { error } = await supabase.from("meal_records").delete().eq("id", job.id);
          if (error) throw error;
        }
        if (job.remove.length) await supabase.storage.from("meal-photos").remove(job.remove);
        // 只移除刚处理完的这个版本；同步期间如果又改了这条记录，新任务保留
        writeJobs(userId, readJobs(userId).filter((j) => !(j.id === job.id && JSON.stringify(j) === JSON.stringify(job))));
        changed = true;
      } catch (err) {
        console.warn("[outbox] 同步失败，稍后重试", err);
        writeJobs(userId, readJobs(userId).map((j) => (j.id === job.id ? { ...j, tries: j.tries + 1 } : j)));
        break; // 多半是网络问题，后面的任务也等下次一起重试
      }
    }
  } finally { running = false; }
  return changed;
}

// 把未同步的本地改动叠加到从服务器读到的列表上。
export function applyPending(meals: Meal[], jobs: Job[], inRange: (m: Meal) => boolean): Meal[] {
  let list = meals.filter((m) => !jobs.some((j) => j.id === m.id && j.kind === "delete"));
  for (const j of jobs) {
    if (j.kind !== "save" || !j.row) continue;
    list = list.filter((m) => m.id !== j.id);
    if (inRange(j.row as Meal)) list.push(j.row as Meal);
  }
  return list.sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
}
