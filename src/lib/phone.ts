// 统一成 E.164。允许直接输入 11 位大陆手机号或带空格/横线的号码。
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let phone = input.replace(/[\s()-]/g, "");
  if (/^1[3-9]\d{9}$/.test(phone)) phone = `+86${phone}`;
  else if (/^00[1-9]/.test(phone)) phone = `+${phone.slice(2)}`;
  else if (/^861[3-9]\d{9}$/.test(phone)) phone = `+${phone}`;
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}
