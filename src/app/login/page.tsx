"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { setStoredAuthKey } from "@/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const [authKey, setAuthKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    const normalizedAuthKey = authKey.trim();
    if (!normalizedAuthKey) {
      toast.error("请输入 密钥");
      return;
    }
    setIsSubmitting(true);
    try {
      await login(normalizedAuthKey);
      await setStoredAuthKey(normalizedAuthKey);
      router.replace("/image");
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 w-full place-items-center overflow-y-auto">
      {/* 卡片容器 */}
      <div className="w-full max-w-[1120px] px-4 py-8">
        <div className="overflow-hidden rounded-3xl border border-border/60 shadow-2xl lg:grid lg:grid-cols-[1.05fr_0.95fr]">
          {/* ── 左侧：品牌面板 ── */}
          <div className="relative flex flex-col justify-between gap-8 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-10 text-white lg:p-12">
            {/* 装饰光晕 */}
            <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/20 blur-[120px]" />
            <div className="pointer-events-none absolute -bottom-16 -right-16 size-56 rounded-full bg-indigo-500/15 blur-[100px]" />

            {/* 品牌 */}
            <div className="relative z-10 space-y-6">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium backdrop-blur-sm">
                <Sparkles className="size-4 text-amber-400" />
                <span>ChatGPT Image Studio</span>
              </div>

              <h2 className="text-3xl font-bold leading-tight tracking-tight lg:text-4xl">
                AI 驱动的
                <br />
                图片创意工作台
              </h2>

              <p className="max-w-sm text-sm leading-relaxed text-zinc-400">
                将 ChatGPT 强大的图像生成能力封装为简洁的创作界面，助你高效产出视觉内容。
              </p>
            </div>

            {/* 能力卡片 */}
            <div className="relative z-10 space-y-3">
              {[
                {
                  title: "多模型支持",
                  desc: "支持 gpt-image-1 等模型，灵活切换以满足不同创作需求。",
                },
                {
                  title: "批量与并发",
                  desc: "多账号负载均衡、并发生图，大幅提升生产效率。",
                },
                {
                  title: "安全管控",
                  desc: "密钥鉴权 + 速率控制，保障接口安全与可用性。",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 backdrop-blur-sm"
                >
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* 底部说明 */}
            <p className="relative z-10 text-xs leading-relaxed text-zinc-500">
              本项目仅限学习与研究用途，请遵守 OpenAI 使用政策。
            </p>
          </div>

          {/* ── 右侧：登录表单 ── */}
          <div className="flex flex-col justify-center gap-8 bg-card p-10 lg:p-12">
            {/* 图标 + 标题 */}
            <div className="space-y-4">
              <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-sm">
                <LockKeyhole className="size-5" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  登录工作区
                </h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  输入后端密钥，进入图片工作台与账号管理界面。
                </p>
              </div>
            </div>

            {/* 密码输入 */}
            <div className="space-y-3">
              <label
                htmlFor="auth-key"
                className="block text-sm font-medium text-foreground"
              >
                密钥
              </label>
              <Input
                id="auth-key"
                type="password"
                value={authKey}
                onChange={(e) => setAuthKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleLogin();
                  }
                }}
                placeholder="请输入后端配置的 AUTH_KEY"
                className="h-12 rounded-2xl px-4"
              />
            </div>

            {/* 提交按钮 */}
            <Button
              className="h-12 w-full rounded-2xl"
              onClick={() => void handleLogin()}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : null}
              进入工作区
            </Button>

            {/* 说明卡片 */}
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-5 py-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                使用同一个密钥即可访问图片生成接口和后台管理页，不需要额外登录步骤。
              </p>
            </div>

            {/* 风险提示卡片 */}
            <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                本项目仅供个人学习、技术研究与非商业交流使用。使用者须自行承担因使用本项目产生的一切风险与法律责任，项目作者不对任何直接或间接后果负责。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
