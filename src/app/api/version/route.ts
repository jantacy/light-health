import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 服务器当前运行的构建版本，前端拿来和自己打包时的版本比对。
export function GET() {
  return NextResponse.json({ version: process.env.NEXT_PUBLIC_BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
