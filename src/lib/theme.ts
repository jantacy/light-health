// 主题色：页面里所有青绿色调的颜色（主按钮、健康卡片、选中态、带绿调的深色文字和灰色、底色、分割线、阴影、
// Logo 等，见 globals.css 里的 var(--c-xxxxxx)）。
// 换主题时把每个颜色的色相拉到目标色相附近（只保留原来与主色色相差的 1/4，免得浅色点缀跑成别的颜色），
// 亮度和饱和度保持不变，所以深浅层次和默认的青绿一致。预设都核对过对比度，不低于默认青绿。
// 红色（预警、删除）、橙色（未确认、同步角标）、营养素圆点、白色叠加不属于主题色，不变。
const BRAND = [
  "0a100ceb", "172a2040", "24392f7a", "263a32", "263a321f", "2e4d3c14", "315f4d", "315f4d20",
  "315f4d22", "334a3c", "34473b", "344a3510", "345640", "416848", "456c4d", "4c6b52",
  "4d6152", "506357", "536c57", "557452", "5f7064", "617361", "65756a", "68776c",
  "688168", "6b8b6c", "6c896c", "6e846f", "6f927d", "718675", "729074", "748377",
  "758279", "7d897f", "7d8a80", "7f8b81", "80a982", "829087", "849087", "869488",
  "89988d", "8a978c", "8a9a8c", "8c988e", "8d9b90", "8da88d", "8da88d1b", "97a397",
  "98a298", "9aa69c", "9ca69b", "9ca69d", "9db89c", "a0aaa0", "a4aea6", "b2c4b3",
  "b9cab7", "c3c9c1", "c3d2c4", "c6cfc3", "c7d5c7", "cbd3c8", "cbd8c9", "d1ddce",
  "d4e2d2", "d9e3c8", "d9e4c5", "dde5d9", "dfe8db", "e1eadf", "e2e8df", "e2e9df",
  "e3eadf", "e3ecd9", "e6ebe3", "e7eee7", "e8eee6", "e8efe7", "e8f0e6", "e9ece6",
  "e9eee7", "eaf1e7", "edf0e8", "edf0e9", "edf1e8", "edf1ea", "edf2e9", "edf2eb",
  "eef4ec", "eff2ec", "f0f2ee", "f0f4ee", "f1f4ef", "f1f5ee", "f3f6f0", "f7f7ee",
  "f7f8f4", "f7f8f499", "f7f8f4e0", "fbfcfa", "8eb491"
];

// hue：目标色相（默认青绿的主色 #315f4d 是 157）。
const BASE_HUE = 157, SPREAD = 0.25;
export const THEMES = [
  { id: "teal", name: "青绿", hue: 157, sat: 1 },
  { id: "ocean", name: "海蓝", hue: 208, sat: 1 },
  { id: "indigo", name: "靛紫", hue: 255, sat: 1 },
  { id: "brown", name: "暖棕", hue: 28, sat: 0.9 },
  { id: "forest", name: "森绿", hue: 115, sat: 1 },
  { id: "graphite", name: "石墨", hue: 207, sat: 0.2 }
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "teal";

function shift(hex: string, hue: number, sat: number) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const diff = ((((h * 60 - BASE_HUE) % 360) + 540) % 360) - 180; // 原色相与主色的差，-180..180
  h = ((((hue + diff * SPREAD) % 360) + 360) % 360);
  const s2 = Math.min(1, s * sat), c = (1 - Math.abs(2 * l - 1)) * s2, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r2, g2, b2] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r2, g2, b2].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("") + hex.slice(6); // 保留透明度
}

const theme = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];
// 某个主题下的颜色（6 位或 8 位 hex，不带 #）。生成图标、启动图的脚本也用它。
export function themed(hex: string, id: string) { const t = theme(id); return t.id === DEFAULT_THEME ? `#${hex}` : shift(hex, t.hue, t.sat); }
export const themeSwatch = (id: ThemeId) => { const t = theme(id); return shift("315f4d", t.hue, t.sat); };

// 应用主题：写到根元素的 CSS 变量上；同时存一份到本机，layout 里的内联脚本在页面绘制前就套用，避免先闪一下默认色。
export function applyTheme(id: string | null | undefined) {
  const t = theme(id), root = document.documentElement.style;
  const vars: Record<string, string> = {};
  for (const hex of BRAND) {
    if (t.id === DEFAULT_THEME) root.removeProperty(`--c-${hex}`);
    else root.setProperty(`--c-${hex}`, (vars[`--c-${hex}`] = shift(hex, t.hue, t.sat)));
  }
  try { localStorage.setItem(THEME_VARS_KEY, JSON.stringify(vars)); } catch {}
  // 浏览器顶栏颜色、图标和 iOS 启动图（public/themes/<id>/，由 scripts/gen-theme-assets.mjs 生成）。
  // iOS 只在“添加到主屏幕”那一刻读取图标和启动图，已添加的要删掉重新添加才会换。
  const base = t.id === DEFAULT_THEME ? "" : `/themes/${t.id}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.id === DEFAULT_THEME ? "#f7f8f4" : shift("f7f8f4", t.hue, t.sat));
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"], link[rel="icon"], link[rel="apple-touch-startup-image"], link[rel="manifest"]')) {
    const file = new URL(link.href).pathname.split("/").pop()!;
    const dir = link.rel === "apple-touch-startup-image" ? (base || "/splash") : base;
    link.href = `${dir}/${file}`;
  }
}
export const THEME_VARS_KEY = "light-meal:theme-vars";
