import { timingSafeEqual } from "node:crypto";

// 管理接口鉴权：请求头 x-license-admin-key 必须等于服务端 LICENSE_ADMIN_SECRET（至少 32 位）。
export function adminAuthorized(request: Request) {
  const expected = process.env.LICENSE_ADMIN_SECRET || "";
  const supplied = request.headers.get("x-license-admin-key") || "";
  if (!expected || expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
