"use client";

import { useRef, useState } from "react";

const OPEN = 76; // 露出的删除按钮宽度

// iOS 风格左滑删除：左滑露出“删除”，再点删除；滑开时点这一行只会收起。竖向滑动照常滚动页面。
export default function SwipeRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; dir?: "h" | "v" } | null>(null);

  function touchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: x };
  }
  function touchMove(e: React.TouchEvent) {
    const s = start.current; if (!s) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.dir) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v"; }
    if (s.dir !== "h") return;
    setDragging(true);
    setX(Math.min(0, Math.max(-OPEN * 1.4, s.base + dx)));
  }
  function touchEnd() {
    if (start.current?.dir === "h") setX((v) => (v < -OPEN / 2 ? -OPEN : 0));
    setDragging(false);
  }
  // 刚滑动过、或者删除按钮正露着：拦下这次点击，不打开编辑。
  function clickCapture(e: React.MouseEvent) {
    if (start.current?.dir === "h" || x !== 0) { e.stopPropagation(); e.preventDefault(); setX(0); }
    start.current = null;
  }

  return <div className="swipe-row">
    <button type="button" className="swipe-delete" style={{ width: OPEN }} tabIndex={x ? 0 : -1} onClick={() => { setX(0); onDelete(); }}>删除</button>
    <div className={`swipe-content${dragging ? "" : " settle"}`} style={{ transform: `translateX(${x}px)` }} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onClickCapture={clickCapture}>{children}</div>
  </div>;
}
