import type { Metadata } from "next";
import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { TopNav } from "@/components/top-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatGpt Image Studio",
  description: "ChatGpt Image Studio workspace",
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
          <Toaster position="top-center" richColors />
          <main className="h-screen overflow-hidden bg-[#f6f5f2] px-3 py-3 text-stone-900 sm:px-4 sm:py-4">
            <div className="mx-auto flex h-full max-w-[1600px] gap-3 lg:gap-4">
              <TopNav />
              <div className="min-w-0 flex-1 overflow-hidden">
                {children}
              </div>
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
