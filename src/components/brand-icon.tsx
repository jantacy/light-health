// 应用图标（同 public/icon.svg），颜色跟随主题色，见 src/lib/theme.ts。
export default function BrandIcon({ className = "brand-mark" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
    <rect width="512" height="512" rx="120" fill="var(--c-315f4d,#315f4d)"/>
    <circle cx="256" cy="256" r="142" fill="#f5f4e9"/>
    <path d="M256 356c-67-39-89-112-65-184 59 4 107 40 116 94 9 52-14 82-51 90Z" fill="var(--c-8eb491,#8eb491)"/>
    <path d="M249 340c4-56 29-99 72-130" fill="none" stroke="var(--c-315f4d,#315f4d)" strokeWidth="12" strokeLinecap="round"/>
  </svg>;
}
