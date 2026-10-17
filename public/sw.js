// 离线缓存：CDN/源站不稳定时仍能打开应用。接口（/api/）和 Supabase 请求不缓存。
const CACHE = "light-meal-v3"; // 只清理 light-meal-v* 旧版本，不碰照片缓存 light-meal-photos
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("light-meal-v") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

// 页面：有缓存就立刻用缓存打开（避免启动黑屏），同时后台更新，下次启动生效；没有缓存才等网络。
async function pageRequest(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (cached) { fresh.catch(() => {}); return cached; }
  try { return await Promise.race([fresh, timeout(8000)]); }
  catch { return (await cache.match("/")) || Response.error(); }
}

// 带 hash 的静态资源：缓存优先。
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// 图标、manifest 等：先给缓存，后台更新。
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(pageRequest(request));
  else if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(request));
});

// 饭点提醒（服务端 src/lib/meal-reminders.ts 推送）。
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || "轻食记", { body: data.body, tag: data.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url || "/" } }));
});

// 点通知：已打开就切到前台，否则打开应用。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const client = list.find((c) => new URL(c.url).origin === self.location.origin);
    return client ? client.focus() : self.clients.openWindow(url);
  }));
});
