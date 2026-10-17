"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

// 下拉刷新：页面在顶部时往下拉，超过 THRESHOLD 松手就刷新。主屏幕打开的 PWA 没有浏览器自带的下拉刷新。
const THRESHOLD = 64;
const MAX = 96;

export default function PullRefresh({ disabled, onRefresh }: { disabled: boolean; onRefresh: () => Promise<void> }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    if (disabled || busy) return;
    const set = (v: number) => { pullRef.current = v; setPull(v); };
    const down = (e: TouchEvent) => { start.current = window.scrollY <= 0 && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
    const move = (e: TouchEvent) => {
      if (!start.current) return;
      const dx = e.touches[0].clientX - start.current.x, dy = e.touches[0].clientY - start.current.y;
      if (pullRef.current === 0 && Math.abs(dx) > Math.abs(dy)) { start.current = null; return; } // 横向滑动（左滑删除）不算
      set(dy > 0 && window.scrollY <= 0 ? Math.min(dy * 0.5, MAX) : 0);
    };
    const up = () => {
      const go = pullRef.current >= THRESHOLD;
      start.current = null; set(0);
      if (go) { setBusy(true); refresh.current().finally(() => setBusy(false)); }
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down); window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up); window.removeEventListener("touchcancel", up);
    };
  }, [disabled, busy]);

  if (!pull && !busy) return null;
  const ready = pull >= THRESHOLD;
  return <div className="pull-refresh" role="status" style={{ opacity: busy ? 1 : Math.min(1, pull / THRESHOLD) }}>
    <RefreshCw size={14} className={busy ? "spin" : ""} style={busy ? undefined : { transform: `rotate(${pull * 4}deg)` }}/>
    {busy ? "正在刷新…" : ready ? "松开刷新" : "下拉刷新"}
  </div>;
}
