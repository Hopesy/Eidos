import { AppStartupRefresh } from "@/components/app-startup-refresh";
import { TopNav } from "@/components/top-nav";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main
      className="box-border h-screen min-h-0 overflow-hidden bg-[#f5f5f3] p-1.5 text-stone-900 dark:bg-stone-950 dark:text-stone-100 lg:p-1.5"
      style={{
        fontFamily:
          '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
      }}
    >
      <AppStartupRefresh />
      <div className="mx-auto flex h-full min-h-0 max-w-[1680px] flex-col gap-1.5 lg:flex-row lg:gap-1.5">
        <TopNav />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </main>
  );
}
