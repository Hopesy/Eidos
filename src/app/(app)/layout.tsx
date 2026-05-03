import { AppStartupRefresh } from "@/components/app-startup-refresh";
import { TopNav } from "@/components/top-nav";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main
      className="box-border min-h-[100dvh] overflow-y-auto bg-[#f5f5f3] p-1 text-stone-900 dark:bg-stone-950 dark:text-stone-100 sm:p-1.5 lg:h-screen lg:min-h-0 lg:overflow-hidden"
      style={{
        fontFamily:
          '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
      }}
    >
      <AppStartupRefresh />
      <div className="mx-auto flex min-h-[calc(100dvh-0.5rem)] max-w-[1680px] flex-col gap-1 lg:h-full lg:min-h-0 lg:flex-row lg:gap-1.5">
        <TopNav />
        <div className="min-w-0 flex-1 overflow-visible lg:min-h-0 lg:overflow-hidden">{children}</div>
      </div>
    </main>
  );
}
