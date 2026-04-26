"use client";

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ImageModel } from "@/lib/api";

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
                <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-stone-900 to-stone-700 shadow-lg dark:from-stone-100 dark:to-stone-300">
                    <Sparkles className="size-6 text-white dark:text-stone-900" />
                </div>
                <div className="space-y-1">
                    <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">开始创作</h2>
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
