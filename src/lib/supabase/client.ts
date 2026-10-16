import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// 登录状态存在 localStorage：Safari 会把脚本写的 cookie 限制为 7 天，而主屏幕 App 的本地存储没有这个限制。
// 本应用没有服务端渲染需要读会话，所以不用 cookie。
export function createClient(): SupabaseClient {
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: typeof window === "undefined" ? undefined : window.localStorage }
  });
}

// 旧版本把会话存在 cookie 里：首次启动新版本时搬到 localStorage，避免用户被登出。只执行一次。
export async function migrateCookieSession(client: SupabaseClient) {
  const FLAG = "light-meal:session-migrated";
  try {
    if (localStorage.getItem(FLAG)) return;
    const { data: current } = await client.auth.getSession();
    if (!current.session && document.cookie.includes("-auth-token")) {
      const { data } = await createBrowserClient(url, anonKey, { auth: { autoRefreshToken: false } }).auth.getSession();
      if (data.session) await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    }
    // 清掉旧 cookie（不调用 signOut，那会注销服务端会话）
    document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter((n) => n.includes("-auth-token")).forEach((n) => { document.cookie = `${n}=; Max-Age=0; path=/`; });
    localStorage.setItem(FLAG, "1");
  } catch {}
}
