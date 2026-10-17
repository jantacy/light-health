// 为每个非默认主题生成图标、manifest 和 iOS 启动图，输出到 public/themes/<id>/。
// 默认的青绿用 public/ 下原有的文件。新增或调整主题后重新运行：
//
//   PLAYWRIGHT_CORE=<playwright-core 路径> node scripts/gen-theme-assets.mjs
//
// 需要本机装有 playwright 的 Chromium（npx playwright-core install chromium）。
// 新主题的启动图用纯色背景（原图的渐变会让每张 PNG 大十几倍）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { THEMES, DEFAULT_THEME, themed } from "../src/lib/theme.ts";
import { SPLASH_DEVICES } from "../src/lib/splash-devices.ts";

const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const { chromium } = pw.chromium ? pw : pw.default; // CommonJS 模块时挂在 default 上
const iconSvg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

// 图标里随主题变的两种颜色：底色 / 叶脉 #315f4d、叶子 #8eb491。PNG 图标是满版方形（iOS 自己裁圆角）。
const svgFor = (id, square = false) => iconSvg
  .replaceAll("#315f4d", themed("315f4d", id)).replaceAll("#8eb491", themed("8eb491", id))
  .replace('rx="120"', square ? 'rx="0"' : 'rx="120"');

const browser = await chromium.launch();
for (const t of THEMES.filter((t) => t.id !== DEFAULT_THEME)) {
  const dir = new URL(`../public/themes/${t.id}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  const paper = themed("f7f8f4", t.id), green = themed("315f4d", t.id);
  writeFileSync(new URL("icon.svg", dir), svgFor(t.id));
  writeFileSync(new URL("manifest.webmanifest", dir), JSON.stringify({
    ...manifest, background_color: paper, theme_color: paper,
    icons: manifest.icons.map((i) => ({ ...i, src: `/themes/${t.id}${i.src}` }))
  }, null, 2) + "\n");

  for (const [size, file] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svgFor(t.id, true)}`);
    await page.screenshot({ path: new URL(file, dir).pathname, omitBackground: true });
    await page.close();
  }

  // 启动图：和应用内启动页一致，64pt 圆角图标 + “轻食记”，居中。
  for (const [w, h, r] of SPLASH_DEVICES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    await page.setContent(`<style>
      *{margin:0}body{height:100vh;background:${paper};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
      svg{width:64px;height:64px;border-radius:21px;display:block}
      strong{font:700 22px/1.3 -apple-system,"PingFang SC","Noto Sans SC",sans-serif;letter-spacing:.12em;color:${green}}
    </style>${svgFor(t.id, true)}<strong>轻食记</strong>`);
    await page.screenshot({ path: new URL(`splash-${w * r}x${h * r}.png`, dir).pathname });
    await page.close();
  }
  console.log(`${t.name}（${t.id}）：已生成`);
}
await browser.close();
