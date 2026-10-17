// 主题色：页面里“品牌色”一类的颜色（主按钮、健康卡片、选中态、浅色底等，见 globals.css 里的 var(--c-xxxxxx)）
// 换主题时把每个颜色的色相拉到目标色相附近（只保留原来与主色色相差的 1/4，免得浅色点缀跑成别的颜色），
// 亮度和饱和度保持不变，所以深浅层次和默认的青绿一致。预设都核对过对比度，不低于默认青绿。
// 黑色文字、灰色、红色预警、营养素圆点等不属于主题色，不变。
const BRAND = [
  "315f4d", "315f4d20", "315f4d22", "345640", "416848", "456c4d", "4c6b52", "536c57",
  "557452", "6b8b6c", "6f927d", "80a982", "8da88d", "8da88d1b", "9db89c", "b2c4b3",
  "b9cab7", "c3d2c4", "c7d5c7", "cbd8c9", "d1ddce", "d4e2d2", "d9e3c8", "d9e4c5",
  "dde5d9", "dfe8db", "e1eadf", "e2e8df", "e2e9df", "e3eadf", "e3ecd9", "e7eee7",
  "e8eee6", "e8efe7", "e8f0e6", "e9eee7", "eaf1e7", "edf0e8", "edf0e9", "edf1e8",
  "edf1ea", "edf2e9", "edf2eb", "eef4ec", "f0f4ee", "f1f5ee"
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
}
export const THEME_VARS_KEY = "light-meal:theme-vars";
