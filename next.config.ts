import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  // sw.js 必须及时更新，不能被 Cloudflare/浏览器长时间缓存
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  }
};
export default nextConfig;
