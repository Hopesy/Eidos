import type { Metadata } from "next";
import { Toaster } from "sonner";

import { AppStartupRefresh } from "@/components/app-startup-refresh";
import { ThemeProvider } from "@/components/theme-provider";
import { TopNav } from "@/components/top-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "EIDOS",
  description: "EIDOS — AI 图片工作区",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AppStartupRefresh />
          <Toaster position="top-center" richColors />
          <main
            className="box-border h-screen min-h-0 overflow-hidden bg-[#f5f5f3] p-1.5 text-stone-900 dark:bg-stone-950 dark:text-stone-100 lg:p-1.5"
            style={{
              fontFamily:
                '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
            }}
          >
            <div className="mx-auto flex h-full min-h-0 max-w-[1680px] flex-col gap-1.5 lg:flex-row lg:gap-1.5">
              <TopNav />
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
