import type { Metadata } from "next";
import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "ChatGPT 号池管理",
  description: "ChatGPT account pool management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <Toaster position="top-center" richColors />
          <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.9911_0_0),transparent_45%),radial-gradient(circle_at_bottom_right,oklch(0.8348_0.1302_160.908_/_0.16),transparent_35%)] px-4 py-3 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
              <TopNav />
              {children}
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
