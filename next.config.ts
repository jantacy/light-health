import type { NextConfig } from "next";

// 每次构建的版本号：前端打包时写死一份，/api/version 返回服务器当前的一份，不一致就说明有新版本。
// 构建时配置会在多个子进程里重复加载，写进环境变量让子进程沿用同一个值。
const buildId = (process.env.LIGHT_MEAL_BUILD_ID ??= Date.now().toString(36));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  output: "standalone",
  // sw.js 必须及时更新，不能被 Cloudflare/浏览器长时间缓存
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  }
};
export default nextConfig;
