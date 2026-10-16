// 所有“某一天”都按用户设备本地时区计算，再转成 UTC ISO 给 timestamptz 查询。
export const todayISO = () => new Date().toLocaleDateString("sv-SE");
export const localDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");

export function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function addDays(date: string, delta: number) {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + delta);
  return d.toLocaleDateString("sv-SE");
}

export const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
