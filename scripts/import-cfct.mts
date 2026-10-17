// 把《中国食物成分表标准版（第6版）》导入共享食物库（source = 'cfct'，覆盖同名的 AI 估算值）。
// 数据来自 https://github.com/Sanotsu/china-food-composition-data （书中表格识别 + 人工校正），运行时下载，不放进仓库。
// 同时把库里已有食物按新的名称规则（food-names.ts）重新归键，同义名合并。
//
//   node --env-file=.env.local scripts/import-cfct.mts          只预演，打印将要写入的内容
//   node --env-file=.env.local scripts/import-cfct.mts --apply  写入数据库
import { foodKey } from "../src/lib/food-names.ts";

const CSV = "https://raw.githubusercontent.com/Sanotsu/china-food-composition-data/main/json_data_v3_20260825_qwen38max_kimi_k3_fixed_en/food_composition_full.csv";
const apply = process.argv.includes("--apply");

// 表里大多是生重。生肉、生鱼按名称直接对上会把熟食算少很多，所以这几类只收带烹饪方式的条目（如“卤”“酱”）。
const RAW_ONLY = ["畜肉类", "禽肉类", "鱼虾蟹贝类"];
// “其他类”多是药材（珍珠、牛黄…），名称容易和日常食物撞上，不收。
const SKIP_CATEGORY = ["其他类"];
// 括号里出现这些词也视为通用条目（如“米饭（蒸，代表值）”→ 米饭，“甘薯（红心）”→ 红薯）。
const NEUTRAL = new Set(["代表值", "全脂", "蒸", "红心"]);
// “鲜”只对蔬菜水果菌藻和鲜玉米算通用；坚果反过来，常吃的是“干”的（鲜核桃 336 kcal，干核桃 646 kcal）。
const FRESH_IS_NEUTRAL = ["蔬菜类", "水果类", "菌藻类", "谷类"];
const DRY_IS_NEUTRAL = ["坚果种子类"];
// 单一烹饪方式的条目另生成“做法+名称”（马铃薯（蒸）→ 蒸土豆）。
const COOK = new Set(["蒸", "煮", "烤", "炸", "炒", "卤", "酱", "熏"]);
// 别名里有歧义的叫法不收（老豆腐通常指北豆腐，不是豆腐脑；地瓜多指红薯，不是豆薯）。
const SKIP_ALIAS = new Set(["老豆腐", "地瓜"]);

type Food = { key: string; display: string; per100: [number, number, number, number]; rank: number };

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ""), r[i]])));
}

const num = (v: string) => (v === "Tr" ? 0 : Number(String(v).replace(/[*\s]/g, "")));

function foodsFrom(rows: Record<string, string>[]) {
  const out = new Map<string, Food>();
  const add = (display: string, per100: Food["per100"], rank: number) => {
    const key = foodKey(display);
    const old = out.get(key);
    if (!old || rank > old.rank) out.set(key, { key, display, per100, rank });
  };
  for (const r of rows) {
    const per100: Food["per100"] = [num(r.energyKCal), num(r.protein), num(r.CHO), num(r.fat)];
    if (per100.some((v) => !Number.isFinite(v) || v < 0)) continue;
    if (SKIP_CATEGORY.some((c) => r.category.startsWith(c))) continue;
    // 新鲜蔬菜含水都在 60% 以上；低于这个的（原书“金针菜（鲜）”含水 40%）不当作日常蔬菜的数值。
    if (r.category.startsWith("蔬菜类") && num(r.water) < 60) continue;
    const name = r.foodName.trim();
    const base = name.replace(/[（［].*$/, "");
    const quals = (name.match(/（([^）]*)）/)?.[1] ?? "").split(/[，,]/).map((s) => s.trim()).filter(Boolean);
    const aliases = (name.match(/［([^］]*)］/)?.[1] ?? "").split(/[、，,]/).map((s) => s.trim()).filter((s) => s && !SKIP_ALIAS.has(s));
    const names = [base, ...aliases];
    const rawOnly = RAW_ONLY.some((c) => r.category.startsWith(c));
    const fresh = FRESH_IS_NEUTRAL.some((c) => r.category.startsWith(c));
    const dry = DRY_IS_NEUTRAL.some((c) => r.category.startsWith(c));
    const neutral = (q: string) => NEUTRAL.has(q) || (fresh && q === "鲜") || (dry && q === "干");
    // 同一个键有多条时：代表值 > 鲜 > 不带括号 > 其他；正名优先于别名（“奶柿子［西红柿］”不能顶掉“番茄［西红柿］”）。
    const rank = quals.includes("代表值") ? 3 : quals.includes("鲜") ? 2.5 : quals.length ? 1 : 2;
    const addAll = (prefix: string, r0: number) => names.forEach((n, i) => add(prefix + n, per100, i ? r0 - 0.5 : r0));
    if (!rawOnly && quals.every(neutral)) addAll("", rank);
    const cook = quals.filter((q) => !neutral(q) || COOK.has(q));
    if (cook.length === 1 && COOK.has(cook[0])) addAll(cook[0], 1);
  }
  return [...out.values()];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，请用 --env-file=.env.local 运行");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text(); // return=minimal 等写操作返回空内容
  return text ? JSON.parse(text) : null;
}

// 1. 已有食物按新规则重新归键：键变了就改名；新键已存在则合并（使用次数相加，保留已存在的那条）。
type Row = { name: string; display_name: string; uses: number; source: string };
const existing: Row[] = await rest("food_library?select=name,display_name,uses,source");
const byKey = new Map(existing.map((r) => [r.name, r]));
for (const r of existing) {
  const k = foodKey(r.display_name);
  if (k === r.name) continue;
  const target = byKey.get(k);
  console.log(target ? `合并  ${r.display_name} → ${target.display_name}` : `改键  ${r.display_name}: ${r.name} → ${k}`);
  if (target) {
    if (apply) {
      await rest(`food_library?name=eq.${encodeURIComponent(k)}`, { method: "PATCH", body: JSON.stringify({ uses: target.uses + r.uses }) });
      await rest(`food_library?name=eq.${encodeURIComponent(r.name)}`, { method: "DELETE" });
    }
    target.uses += r.uses;
  } else {
    if (apply) await rest(`food_library?name=eq.${encodeURIComponent(r.name)}`, { method: "PATCH", body: JSON.stringify({ name: k }) });
    byKey.set(k, { ...r, name: k });
  }
  byKey.delete(r.name);
}

// 2. 导入成分表：同键覆盖 AI 估算值，使用次数保留。
const foods = foodsFrom(parseCsv(await (await fetch(CSV)).text()));
const replaced = foods.filter((f) => byKey.has(f.key));
console.log(`成分表可用条目 ${foods.length} 个，其中覆盖库里已有的 ${replaced.length} 个：`);
for (const f of replaced) console.log(`  ${byKey.get(f.key)!.display_name} ← ${f.display} ${f.per100.join("/")}`);
if (process.argv.includes("--list")) for (const f of foods) console.log(`${f.key}\t${f.display}\t${f.per100.join("/")}`);
if (apply) {
  const now = new Date().toISOString();
  const rows = foods.map((f) => ({ name: f.key, display_name: f.display, calories_100g: f.per100[0], protein_100g: f.per100[1], carbs_100g: f.per100[2], fat_100g: f.per100[3], source: "cfct", needs_refresh: false, updated_at: now }));
  for (let i = 0; i < rows.length; i += 500) await rest("food_library?on_conflict=name", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });
  console.log(`已写入 ${rows.length} 条。`);
} else console.log("（预演，未写入。加 --apply 写入数据库）");
