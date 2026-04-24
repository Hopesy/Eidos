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
        <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
            <div className="max-w-[760px]">
                <div className="inline-flex size-14 items-center justify-center rounded-[20px] bg-stone-950 text-white shadow-sm">
                    <Sparkles className="size-5" />
                </div>
                <h1 className="mt-6 text-3xl font-semibold tracking-tight text-stone-950 lg:text-5xl">
                    从一个提示词，开始完整的图像工作流。
                </h1>
            </div>

            <div className="hide-scrollbar flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
                {examples.map((example) => (
                    <button
                        key={example.id}
                        type="button"
                        onClick={() => onApplyExample(example)}
                        className="w-[220px] shrink-0 overflow-hidden rounded-[22px] border border-stone-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm md:w-auto"
                    >
                        <div className={cn("h-[4.5rem] bg-gradient-to-br md:h-20", example.tone)} />
                        <div className="space-y-2 px-4 py-3.5">
                            <div className="flex items-center gap-2 text-[11px] text-stone-500">
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium">Prompt</span>
                                <span>{example.model}</span>
                            </div>
                            <div className="text-sm font-semibold tracking-tight text-stone-900">{example.title}</div>
                            <div className="line-clamp-2 text-sm leading-6 text-stone-600">{example.prompt}</div>
                            <div className="border-t border-stone-100 pt-2 text-xs leading-5 text-stone-500">{example.hint}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
