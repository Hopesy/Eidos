"use client";

import { cn } from "@/lib/utils";
import type { ImageModel } from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";

export type InspirationExample = {
    id: string;
    title: string;
    prompt: string;
    hint: string;
    model: ImageModel;
    count: number;
    tone: string;
};

export type EmptyStateProps = {
    examples: InspirationExample[];
    onApplyExample: (example: InspirationExample) => void;
};

export function EmptyState({ examples, onApplyExample }: EmptyStateProps) {
    return (
        <div className="mx-auto flex min-h-full max-w-[1080px] flex-col justify-center gap-4 px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
            <div className="flex flex-col items-center gap-2 text-center sm:gap-3">
                <BrandMark className="size-8 sm:size-11" />
                <div className="flex w-full flex-col items-center justify-center space-y-1 text-center">
                    <div className="flex flex-col items-center justify-center gap-1 text-stone-900 dark:text-stone-100 sm:flex-row sm:gap-2">
                        <div className="text-sm font-semibold leading-none tracking-[0.18em] sm:text-lg sm:tracking-[0.22em]">EIDOS</div>
                        <span className="hidden text-[3.375rem] leading-none sm:block">·</span>
                        <h2 className="text-base font-bold leading-none sm:text-xl">开始创作</h2>
                    </div>
                    <p className="hidden max-w-[26rem] text-sm leading-6 text-stone-500 dark:text-stone-400 sm:block">上传参考图、输入文字，描述你想生成的图片</p>
                </div>
            </div>
            <div className="hidden sm:grid sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
                {examples.map((example) => (
                    <button
                        key={example.id}
                        type="button"
                        onClick={() => onApplyExample(example)}
                        className="w-full overflow-hidden rounded-[22px] border border-stone-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-600"
                    >
                        <div className={cn("h-7 bg-gradient-to-br sm:h-20", example.tone)} />
                        <div className="space-y-1.5 px-3 py-2.5 sm:space-y-2 sm:px-4 sm:py-3.5">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium dark:bg-stone-700 dark:text-stone-300">Prompt</span>
                                <span>{example.model}</span>
                            </div>
                            <div className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">{example.title}</div>
                            <div className="line-clamp-2 text-[13px] leading-5 text-stone-600 dark:text-stone-300 sm:line-clamp-3 sm:text-sm sm:leading-6">{example.prompt}</div>
                            <div className="hidden border-t border-stone-100 pt-2 text-xs leading-5 text-stone-500 dark:border-stone-700 dark:text-stone-400 sm:block">{example.hint}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
