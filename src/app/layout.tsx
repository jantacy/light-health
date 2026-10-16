import type { Metadata, Viewport } from "next";
import "./globals.css";
import SwRegister from "@/components/sw-register";

export const metadata: Metadata = {
  title: "轻食记 · 私人饮食记录",
  description: "记录每一餐，照顾好自己的节奏。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "轻食记" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" }
};

export const viewport: Viewport = { themeColor: "#f7f8f4", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}<SwRegister/></body></html>;
}
