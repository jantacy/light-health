import type { Metadata, Viewport } from "next";
import "./globals.css";
import SwRegister from "@/components/sw-register";

// iOS 主屏幕启动图：页面绘制前由系统显示，避免黑屏。[逻辑宽, 逻辑高, 像素比]
const devices = [[375, 667, 2], [414, 896, 2], [375, 812, 3], [390, 844, 3], [393, 852, 3], [428, 926, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3]];
const startupImage = devices.map(([w, h, r]) => ({
  url: `/splash/splash-${w * r}x${h * r}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`
}));

export const metadata: Metadata = {
  title: "轻食记 · 私人饮食记录",
  description: "记录每一餐，照顾好自己的节奏。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "轻食记", startupImage },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" }
};

export const viewport: Viewport = { themeColor: "#f7f8f4", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 主题色在页面绘制前套用（见 src/lib/theme.ts），避免先闪一下默认的青绿。
  const theme = "try{var m=JSON.parse(localStorage.getItem('light-meal:theme-vars')||'{}');for(var k in m)document.documentElement.style.setProperty(k,m[k])}catch(e){}";
  return <html lang="zh-CN"><head><script dangerouslySetInnerHTML={{ __html: theme }}/></head><body>{children}<SwRegister/></body></html>;
}
