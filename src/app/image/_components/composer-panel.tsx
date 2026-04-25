"use client";

import type { ClipboardEvent, RefObject } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, Trash2, Upload, Sparkles, Pencil, ZoomIn } from "lucide-react";

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
import type { ImageGenerationQuality, ImageGenerationSize, ImageModel } from "@/lib/api";
import type { ImageMode, StoredSourceImage } from "@/store/image-conversations";

export type ModeOption = { label: string; value: ImageMode; description: string };
export type ImageModelOption = { label: string; value: ImageModel };
export type GenerationOption<T extends string> = { label: string; value: T };

export type ComposerPanelProps = {
    imageModel: ImageModel;
    imageModelOptions: ImageModelOption[];
    modeOptions: ModeOption[];
    mode: ImageMode;
    onModeChange: (mode: ImageMode) => void;
    onImageModelChange: (model: ImageModel) => void;
    hasGenerateReferences: boolean;
    imageCount: string;
    onImageCountChange: (value: string) => void;
    imageSize: ImageGenerationSize;
    imageSizeOptions: GenerationOption<ImageGenerationSize>[];
    onImageSizeChange: (value: ImageGenerationSize) => void;
    imageQuality: ImageGenerationQuality;
    imageQualityOptions: GenerationOption<ImageGenerationQuality>[];
    onImageQualityChange: (value: ImageGenerationQuality) => void;
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
    onCancel: () => void;
    isSubmitting: boolean;
    uploadInputRef: RefObject<HTMLInputElement | null>;
    maskInputRef: RefObject<HTMLInputElement | null>;
    onUploadFiles: (files: FileList | null, role: "image" | "mask") => void;
};

export function ComposerPanel({
    imageModel,
    imageModelOptions,
    modeOptions,
    mode,
    onModeChange,
    onImageModelChange,
    hasGenerateReferences,
    imageCount,
    onImageCountChange,
    imageSize,
    imageSizeOptions,
    onImageSizeChange,
    imageQuality,
    imageQualityOptions,
    onImageQualityChange,
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
    onCancel,
    isSubmitting,
    uploadInputRef,
    maskInputRef,
    onUploadFiles,
}: ComposerPanelProps) {
    return (
        <div className="shrink-0 border-t border-stone-200/60 bg-white px-3 py-2.5 sm:px-5 sm:py-3">
            <div className="mx-auto flex max-w-[980px] flex-col gap-2.5">
                <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                    <div className="inline-flex rounded-full bg-stone-100 p-1 shadow-sm ring-1 ring-stone-900/5">
                        {modeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                onClick={() => onModeChange(item.value)}
                                className={cn(
                                    "flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200",
                                    mode === item.value
                                        ? "bg-[#20232d] text-white shadow-[0_2px_8px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)]"
                                        : "text-stone-600 hover:text-stone-900 hover:bg-stone-50",
                                )}
                            >
                                {item.value === "generate" && <Sparkles className="size-3.5" />}
                                {item.value === "edit" && <Pencil className="size-3.5" />}
                                {item.value === "upscale" && <ZoomIn className="size-3.5" />}
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={imageModel} onValueChange={(value) => onImageModelChange(value as ImageModel)}>
                            <SelectTrigger className="h-8 w-[120px] rounded-lg border-stone-200/80 bg-white text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-900/5 transition-all hover:border-stone-300 hover:shadow focus-visible:ring-2 focus-visible:ring-stone-900/10">
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
                            <div className="flex h-8 items-center gap-2 rounded-lg border border-stone-200/80 bg-white px-3 shadow-sm ring-1 ring-stone-900/5 transition-all hover:border-stone-300 hover:shadow">
                                <span className="text-xs font-medium text-stone-500">张数</span>
                                <Input
                                    type="number"
                                    min="1"
                                    max="8"
                                    step="1"
                                    value={imageCount}
                                    onChange={(event) => onImageCountChange(event.target.value)}
                                    className="h-6 w-[48px] border-0 bg-transparent px-0 text-center text-sm font-medium text-stone-900 shadow-none focus-visible:ring-0"
                                />
                            </div>
                        ) : null}

                        {mode === "generate" ? (
                            <>
                                <Select value={imageSize} onValueChange={(value) => onImageSizeChange(value as ImageGenerationSize)}>
                                    <SelectTrigger className="h-8 w-[90px] rounded-lg border-stone-200/80 bg-white text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-900/5 transition-all hover:border-stone-300 hover:shadow focus-visible:ring-2 focus-visible:ring-stone-900/10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {imageSizeOptions.map((item) => (
                                            <SelectItem key={item.value} value={item.value}>
                                                {item.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={imageQuality} onValueChange={(value) => onImageQualityChange(value as ImageGenerationQuality)}>
                                    <SelectTrigger className="h-8 w-[90px] rounded-lg border-stone-200/80 bg-white text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-900/5 transition-all hover:border-stone-300 hover:shadow focus-visible:ring-2 focus-visible:ring-stone-900/10">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {imageQualityOptions.map((item) => (
                                            <SelectItem key={item.value} value={item.value}>
                                                {item.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}

                        {mode === "upscale" ? (
                            <Select value={upscaleScale} onValueChange={onUpscaleScaleChange}>
                                <SelectTrigger className="h-8 w-[132px] rounded-lg border-stone-200/80 bg-white text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-900/5 transition-all hover:border-stone-300 hover:shadow focus-visible:ring-2 focus-visible:ring-stone-900/10">
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

                        <div className="flex h-8 items-center gap-2 rounded-lg bg-gradient-to-br from-stone-100 to-stone-50 px-3 shadow-sm ring-1 ring-stone-900/5">
                            <span className="text-xs font-medium text-stone-500">额度</span>
                            <span className="text-sm font-semibold text-stone-900">{availableQuota}</span>
                        </div>
                    </div>
                </div>

                <div
                    className="overflow-hidden rounded-[18px] border border-stone-200 bg-[#fafaf9] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                    onClick={() => {
                        textareaRef.current?.focus();
                    }}
                >
                    {sourceImages.length > 0 ? (
                        <div className="hide-scrollbar flex gap-2 overflow-x-auto border-b border-stone-200 px-3 py-2">
                            {sourceImages.map((item) => (
                                <div
                                    key={item.id}
                                    className="w-[116px] shrink-0 overflow-hidden rounded-[14px] border border-stone-200/80 bg-stone-50/75"
                                >
                                    <div className="flex items-center justify-between border-b border-stone-200/70 px-1.5 py-[2px] text-[8px] font-medium leading-none text-stone-500">
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
                                            className="block h-[68px] w-full bg-transparent object-contain p-1"
                                        />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div className="px-2.5 pb-1 pt-2">
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
                            className="min-h-[36px] max-h-[180px] resize-none border-0 bg-transparent !px-0 !pt-0 !pb-0 text-[15px] leading-6 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:ring-0 overflow-y-auto"
                        />
                    </div>
                    <div className="px-2.5 pb-2.5 pt-1.5">
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

                            {isSubmitting ? (
                                <button
                                    type="button"
                                    onClick={onCancel}
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                    aria-label="取消生成"
                                    title="取消生成"
                                >
                                    <LoaderCircle className="size-4 animate-spin" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onSubmit}
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800"
                                    aria-label="提交图片任务"
                                >
                                    <ArrowUp className="size-4" />
                                </button>
                            )}
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
    );
}
