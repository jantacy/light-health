"use client";

import { CalendarDays } from "lucide-react";
import { todayISO, weekdayDate } from "@/lib/date";

// 显示“10月16日 周五（今天）”，点击弹出系统日期选择；不能选未来日期。
export default function DateField({ value, onChange, label = "日期" }: { value: string; onChange: (date: string) => void; label?: string }) {
  return <label className="field-label">{label}
    <span className="date-field">
      <CalendarDays size={16}/>
      <span>{weekdayDate(value)}{value === todayISO() && <small>（今天）</small>}</span>
      <input type="date" max={todayISO()} value={value} required onChange={(e) => e.target.value && onChange(e.target.value)}/>
    </span>
  </label>;
}
