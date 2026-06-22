import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "华山论股 · 16 位投资大师齐聚论股",
  description: "AI 持仓诊断 + 多空辩论 + 风控审核。基于 huashan-lungu-v2 skill。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="ink-bg min-h-screen font-serif antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
