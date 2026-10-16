import type { SupabaseClient } from "@supabase/supabase-js";

// 照片本地缓存：签名 URL 每次都不同、浏览器缓存命中不了，所以按存储路径把图片文件存进 Cache Storage。
// 保存 7 天，启动时清理过期的；离线时过期的也照样显示。
const CACHE = "light-meal-photos";
const TTL = 7 * 86400000;
const keyOf = (bucket: string, path: string) => `/__photos/${bucket}/${path}`;
const hasCache = () => typeof caches !== "undefined";

export async function rememberPhoto(bucket: string, path: string, blob: Blob) {
  if (!hasCache()) return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(keyOf(bucket, path), new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg", "X-Cached-At": String(Date.now()) } }));
  } catch {}
}

export async function photoUrl(supabase: SupabaseClient, bucket: string, path: string): Promise<string | null> {
  let stale: Response | undefined;
  if (hasCache()) {
    try {
      const hit = await (await caches.open(CACHE)).match(keyOf(bucket, path));
      if (hit && Date.now() - Number(hit.headers.get("X-Cached-At")) < TTL) return URL.createObjectURL(await hit.blob());
      stale = hit;
    } catch {}
  }
  const { data } = await supabase.storage.from(bucket).download(path);
  if (data) { rememberPhoto(bucket, path, data); return URL.createObjectURL(data); }
  return stale ? URL.createObjectURL(await stale.blob()) : null;
}

export async function prunePhotos() {
  if (!hasCache()) return;
  try {
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) {
      const hit = await cache.match(request);
      if (!hit || Date.now() - Number(hit.headers.get("X-Cached-At")) > TTL) await cache.delete(request);
    }
  } catch {}
}
