// 把一行里写的多种食物拆开：“红烧鲫鱼100g，番茄炒蛋100g，米饭” → 三项。
// 按逗号、顿号、分号、加号、换行分隔，括号里的不拆（“葱油酱油汁（含油、糖）”是一样东西）。
// 每段末尾的重量（100g / 100克 / 250ml / 250毫升）拆成克数，没写的留空让 AI 按常见一人份估算。
// 只有一样食物时返回 null。
export function splitFoods(text: string): { name: string; grams: number }[] | null {
  const parts: string[] = [];
  let depth = 0, current = "";
  for (const c of text) {
    if ("（(【[".includes(c)) depth++;
    else if ("）)】]".includes(c)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[，,、;；+＋\n]/.test(c)) { parts.push(current); current = ""; } else current += c;
  }
  parts.push(current);
  const foods = parts.map((p) => p.trim()).filter(Boolean).map(parseFood);
  return foods.length > 1 ? foods : null;
}

// “番茄炒蛋 200g” → { name: "番茄炒蛋", grams: 200 }；末尾没写重量时 grams 为 0。
export function parseFood(text: string) {
  const m = text.trim().match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)$/i);
  return m ? { name: m[1].trim(), grams: Math.round(Number(m[2])) } : { name: text.trim(), grams: 0 };
}
