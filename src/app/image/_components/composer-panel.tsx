"use client";

import type { ChangeEvent, ClipboardEvent, MutableRefObject, RefObject } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, PanelLeftClose, PanelLeftOpen, Trash2, Upload } from "lucide-react";

import { AppImage as Image } from "@/components/app-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ImageModel } from "@/lib/api";
import type { ImageMode, StoredSourceImage } from "@/store/image-conversations";

export type ModeOption = { label: string; value: ImageMode; description: string };
export type ImageModelOption = { label: string; value: ImageModel };

export type ComposerPanelProps = {
    historyCollapsed: boolean;
    onToggleHistoryCollapsed: () => void;
    selectedConversationTitle: string | null;
    imageModel: ImageModel;
    imageModelOptions: ImageModelOption[];
    modeOptions: ModeOption[];
    mode: ImageMode;
    onModeChange: (mode: ImageMode) => void;
    onImageModelChange: (model: ImageModel) => void;
    hasGenerateReferences: boolean;
    imageCount: string;
    onImageCountChange: (value: string) => void;
    upscaleScale: string;
    upscaleOptions: string[];
    onUpscaleScaleChange: (value: string) => void;
    availableQuota: string;
    sourceImages: StoredSourceImage[];
    onRemoveSourceImage: (id: string) => void;
    onOpenImageInNewTab: (dataUrl: string) => void;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    imagePrompt: string;
    onImagePromptChange: (value: string) => void;
    onPromptPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
    onSubmit: () => void;
    isSubmitting: boolean;
    uploadInputRef: RefObject<HTMLInputElement | null>;
    maskInputRef: RefObject<HTMLInputElement | null>;
    onUploadFiles: (files: FileList | null, role: "image" | "mask") => void;
};

export function ComposerPanel({
    historyCollapsed,
    onToggleHistoryCollapsed,
    selectedConversationTitle,
    imageModel,
    imageModelOptions,
    modeOptions,
    mode,
    onModeChange,
    onImageModelChange,
    hasGenerateReferences,
    imageCount,
    onImageCountChange,
    upscaleScale,
    upscaleOptions,
    onUpscaleScaleChange,
    availableQuota,
    sourceImages,
    onRemoveSourceImage,
    onOpenImageInNewTab,
    textareaRef,
    imagePrompt,
    onImagePromptChange,
    onPromptPaste,
    onSubmit,
    isSubmitting,
    uploadInputRef,
    maskInputRef,
    onUploadFiles,
}: ComposerPanelProps) {
    return (
        <>
            <div className="border-b border-stone-200/80 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 rounded-full border-stone-200 bg-white px-4 text-stone-700 shadow-none"
                                onClick={onToggleHistoryCollapsed}
                            >
                                {historyCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                                {historyCollapsed ? "展开历史" : "收起历史"}
                            </Button>
                            <h1 className="text-xl font-semibold tracking-tight text-stone-950 sm:text-[22px]">图片工作台</h1>
                            {selectedConversationTitle ? (
                                <span className="truncate rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                                    {selectedConversationTitle}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                        <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5">模型 {imageModel}</span>
                    </div>
                </div>
            </div>

            <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-3 sm:px-5 sm:py-4">
                <div className="mx-auto flex max-w-[980px] flex-col gap-3">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="inline-flex rounded-full bg-stone-100 p-1">
                            {modeOptions.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => onModeChange(item.value)}
                                    className={cn(
                                        "rounded-full px-4 py-2 text-sm font-medium transition",
                                        mode === item.value
                                            ? "bg-stone-950 text-white shadow-sm"
                                            : "text-stone-600 hover:bg-stone-200 hover:text-stone-900",
                                    )}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={imageModel} onValueChange={(value) => onImageModelChange(value as ImageModel)}>
                                <SelectTrigger className="h-10 w-[164px] rounded-full border-stone-200 bg-white text-sm font-medium text-stone-700 shadow-none focus-visible:ring-0">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {imageModelOptions.map((item) => (
                                        <SelectItem key={item.value} value={item.value}>
                                            {item.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {mode === "generate" && !hasGenerateReferences ? (
                                <div className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1">
                                    <span className="text-sm font-medium text-stone-700">张数</span>
                                    <Input
                                        type="number"
                                        min="1"
                                        max="8"
                                        step="1"
                                        value={imageCount}
                                        onChange={(event) => onImageCountChange(event.target.value)}
                                        className="h-8 w-[64px] border-0 bg-transparent px-0 text-center text-sm font-medium text-stone-700 shadow-none focus-visible:ring-0"
                                    />
                                </div>
                            ) : null}

                            {mode === "upscale" ? (
                                <Select value={upscaleScale} onValueChange={onUpscaleScaleChange}>
                                    <SelectTrigger className="h-10 w-[132px] rounded-full border-stone-200 bg-white text-sm font-medium text-stone-700 shadow-none focus-visible:ring-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {upscaleOptions.map((item) => (
                                            <SelectItem key={item} value={item}>
                                                {item}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : null}

                            <span className="rounded-full bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600">
                                剩余额度 {availableQuota}
                            </span>
                        </div>
                    </div>

                    <div
                        className="overflow-hidden rounded-[28px] border border-stone-200 bg-[#fafaf9] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                        onClick={() => {
                            textareaRef.current?.focus();
                        }}
                    >
                        {sourceImages.length > 0 ? (
                            <div className="hide-scrollbar flex gap-3 overflow-x-auto border-b border-stone-200 px-4 py-3">
                                {sourceImages.map((item) => (
                                    <div
                                        key={item.id}
                                        className="w-[126px] shrink-0 overflow-hidden rounded-[18px] border border-stone-200 bg-white"
                                    >
                                        <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2 text-[11px] font-medium text-stone-500">
                                            <span>{item.role === "mask" ? "遮罩" : "源图"}</span>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onRemoveSourceImage(item.id);
                                                }}
                                                className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-rose-500"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            className="block w-full cursor-zoom-in"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onOpenImageInNewTab(item.dataUrl);
                                            }}
                                        >
                                            <Image
                                                src={item.dataUrl}
                                                alt={item.name}
                                                className="block h-20 w-full bg-stone-50 object-contain"
                                            />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div className="px-4 pb-2 pt-3">
                            <Textarea
                                ref={textareaRef}
                                value={imagePrompt}
                                onChange={(event) => onImagePromptChange(event.target.value)}
                                placeholder={
                                    mode === "generate"
                                        ? "描述你想生成的画面，也可以先上传参考图"
                                        : mode === "edit"
                                            ? "描述你想如何修改当前图片"
                                            : "可选：描述你想增强的方向"
                                }
                                onPaste={onPromptPaste}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault();
                                        if (!isSubmitting) {
                                            onSubmit();
                                        }
                                    }
                                }}
                                className="min-h-[92px] max-h-[480px] resize-none border-0 bg-transparent !px-1 !pt-1 !pb-1 text-[15px] leading-7 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:ring-0 overflow-y-auto"
                            />
                        </div>
                        <div className="px-4 pb-4 pt-2">
                            <div className="flex items-end justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-full border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 shadow-none"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            uploadInputRef.current?.click();
                                        }}
                                    >
                                        <ImagePlus className="size-3.5" />
                                        {mode === "generate" ? "上传参考图" : "上传源图"}
                                    </Button>

                                    {mode === "edit" ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 rounded-full border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 shadow-none"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                maskInputRef.current?.click();
                                            }}
                                        >
                                            <Upload className="size-3.5" />
                                            遮罩
                                        </Button>
                                    ) : null}
                                </div>

                                <button
                                    type="button"
                                    onClick={onSubmit}
                                    disabled={isSubmitting}
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                                    aria-label="提交图片任务"
                                >
                                    {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                                </button>
                            </div>
                        </div>

                        <input
                            ref={uploadInputRef}
                            type="file"
                            accept="image/*"
                            multiple={mode !== "upscale"}
                            className="hidden"
                            onChange={(event) => {
                                onUploadFiles(event.target.files, "image");
                                event.currentTarget.value = "";
                            }}
                        />
                        <input
                            ref={maskInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                                onUploadFiles(event.target.files, "mask");
                                event.currentTarget.value = "";
                            }}
                        />
                    </div>
                </div>
            </div>
        </>
    );
}
