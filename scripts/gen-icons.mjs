// 按 public/icon.svg 生成桌面图标 PNG（满版方形，iOS 自己裁圆角），和页面里的 Logo 同图形。
// 修改 icon.svg 后重新运行：
//
//   PLAYWRIGHT_CORE=<playwright-core 路径> node scripts/gen-icons.mjs
//
// 需要本机装有 playwright 的 Chromium（npx playwright-core install chromium）。
import { readFileSync } from "node:fs";

const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const { chromium } = pw.chromium ? pw : pw.default; // CommonJS 模块时挂在 default 上
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8").replace('rx="120"', 'rx="0"');

const browser = await chromium.launch();
for (const [size, file] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();
console.log("已生成 apple-touch-icon.png、icon-192.png、icon-512.png");
