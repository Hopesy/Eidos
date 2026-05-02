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
        <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center gap-3 text-center">
                <BrandMark className="size-11" />
                <div className="flex w-full flex-col items-center space-y-1">
                    <div className="flex translate-x-[5px] items-center justify-center gap-2 whitespace-nowrap text-stone-900 dark:text-stone-100">
                        <div className="text-lg font-semibold leading-none tracking-[0.22em]">EIDOS</div>
                        <span className="text-[3.375rem] leading-none">·</span>
                        <h2 className="text-xl font-bold leading-none">开始创作</h2>
                    </div>
                    <p className="text-sm text-stone-500 dark:text-stone-400">上传参考图、输入文字，描述你想生成的图片</p>
                </div>
            </div>
            <div className="hide-scrollbar flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
                {examples.map((example) => (
                    <button
                        key={example.id}
                        type="button"
                        onClick={() => onApplyExample(example)}
                        className="w-[220px] shrink-0 overflow-hidden rounded-[22px] border border-stone-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm md:w-auto dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-600"
                    >
                        <div className={cn("h-[4.5rem] bg-gradient-to-br md:h-20", example.tone)} />
                        <div className="space-y-2 px-4 py-3.5">
                            <div className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium dark:bg-stone-700 dark:text-stone-300">Prompt</span>
                                <span>{example.model}</span>
                            </div>
                            <div className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">{example.title}</div>
                            <div className="line-clamp-2 text-sm leading-6 text-stone-600 dark:text-stone-300">{example.prompt}</div>
                            <div className="border-t border-stone-100 pt-2 text-xs leading-5 text-stone-500 dark:border-stone-700 dark:text-stone-400">{example.hint}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
