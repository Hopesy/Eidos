"use client";

import type { ClipboardEvent, RefObject } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, Sparkles, Upload, SquarePen, Maximize2, Square, RectangleVertical, Monitor, Smartphone, Cpu, Tv, Hash, Ratio, FileImage, X } from "lucide-react";

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
import type { ImageRatioOption } from "@/shared/image-generation";
import { cn } from "@/lib/utils";
import type { ImageGenerationQuality, ImageModel, ImageOutputFormat } from "@/lib/api";
import type { ImageMode, StoredSourceImage } from "@/store/image-conversations";

export type ModeOption = { label: string; value: ImageMode; description: string };
export type ImageModelOption = { label: string; value: ImageModel };
export type GenerationOption<T extends string> = { label: string; value: T };
export type ToolbarImageSize = ImageRatioOption;

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
    imageSize: ToolbarImageSize;
    imageSizeOptions: GenerationOption<ToolbarImageSize>[];
    onImageSizeChange: (value: ToolbarImageSize) => void;
    imageQuality: ImageGenerationQuality;
    imageQualityOptions: GenerationOption<ImageGenerationQuality>[];
    onImageQualityChange: (value: ImageGenerationQuality) => void;
    imageFormat: ImageOutputFormat;
    upscaleQuality: ImageGenerationQuality;
    upscaleQualityOptions: GenerationOption<ImageGenerationQuality>[];
    onUpscaleQualityChange: (value: ImageGenerationQuality) => void;
    availableQuota: string;
    sourceImages: StoredSourceImage[];
    onRemoveSourceImage: (id: string) => void;
    canToggleLatestResultReference: boolean;
    useLatestResultAsReference: boolean;
    onToggleLatestResultReference: () => void;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    imagePrompt: string;
    onImagePromptChange: (value: string) => void;
    onPromptPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
    onSubmit: () => void;
    onCancel: () => void;
    cancelButtonLabel: string;
    cancelButtonTitle: string;
    isSubmitting: boolean;
    uploadInputRef: RefObject<HTMLInputElement | null>;
    onUploadFiles: (files: FileList | null) => void;
    onOpenMaskEditor: () => void;
};

function renderQualityOption(value: ImageGenerationQuality, label: string) {
    return (
        <div className="flex items-center gap-2">
            {value === "auto" && <Sparkles className="size-3.5" />}
            {value === "low" && <Smartphone className="size-3.5" />}
            {value === "medium" && <Monitor className="size-3.5" />}
            {value === "high" && <Tv className="size-3.5" />}
            <span>{label}</span>
        </div>
    );
}

function getImageFormatLabel(value: ImageOutputFormat) {
    if (value === "jpeg") {
        return "JPEG";
    }
    if (value === "webp") {
        return "WebP";
    }
    return "PNG";
}

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
    imageFormat,
    upscaleQuality,
    upscaleQualityOptions,
    onUpscaleQualityChange,
    availableQuota,
    sourceImages,
    onRemoveSourceImage,
    canToggleLatestResultReference,
    useLatestResultAsReference,
    onToggleLatestResultReference,
    textareaRef,
    imagePrompt,
    onImagePromptChange,
    onPromptPaste,
    onSubmit,
    onCancel,
    cancelButtonLabel,
    cancelButtonTitle,
    isSubmitting,
    uploadInputRef,
    onUploadFiles,
    onOpenMaskEditor,
}: ComposerPanelProps) {
    const uploadLabel = mode === "generate" ? "上传参考图" : "上传源图";

    return (
        <div className="shrink-0 border-t border-stone-200/60 bg-white py-2.5 sm:py-3 dark:border-stone-700 dark:bg-stone-900">
            <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2.5 px-6 sm:px-10 lg:px-12">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="inline-flex w-full shrink-0 rounded-full bg-stone-100 p-1 shadow-sm ring-1 ring-stone-900/5 sm:w-[156px] dark:bg-stone-800 dark:ring-stone-700">
                        {modeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                onClick={() => onModeChange(item.value)}
                                className={cn(
                                    "flex flex-1 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200 sm:flex-1",
                                    mode === item.value
                                        ? "bg-[#20232d] text-white shadow-[0_2px_8px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)] dark:bg-stone-100 dark:text-stone-900"
                                        : "text-stone-600 hover:text-stone-900 hover:bg-stone-50 dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-stone-700",
                                )}
                            >
                                {item.value === "generate" && <Sparkles className="size-3.5" />}
                                {item.value === "edit" && <SquarePen className="size-3.5" />}
                                {item.value === "upscale" && <Maximize2 className="size-3.5" />}
                                {item.label}
                            </button>
                        ))}
                    </div>
                    {mode === "upscale" ? (
                        <div className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            <Maximize2 className="size-3.5" />
                            增强当前图片
                        </div>
                    ) : null}

                    <div className="flex w-full flex-wrap items-center gap-1 sm:flex-1 sm:justify-end sm:gap-2">
                        <Select value={imageModel} onValueChange={(value) => onImageModelChange(value as ImageModel)}>
                            <SelectTrigger className="h-8 w-[112px] shrink-0 rounded-lg border-stone-200/80 bg-white px-1.5 text-[11px] font-medium text-stone-700 ring-1 ring-stone-900/5 transition-all hover:border-stone-300 focus-visible:ring-2 focus-visible:ring-stone-900/10 sm:w-[140px] sm:px-3 sm:text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700 dark:hover:border-stone-600">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {imageModelOptions.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>
                                        <div className="flex items-center gap-2">
                                            <Cpu className="size-3.5" />
                                            <span>{item.label}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {mode === "generate" && !hasGenerateReferences ? (
                            <div className="flex h-8 w-[52px] shrink-0 items-center gap-0.5 rounded-lg border border-stone-200/80 bg-white px-1.5 ring-1 ring-stone-900/5 transition-all hover:border-stone-300 sm:w-auto sm:gap-1.5 sm:px-2.5 dark:border-stone-700 dark:bg-stone-800 dark:ring-stone-700 dark:hover:border-stone-600">
                                <Hash className="size-3.5 text-stone-400 dark:text-stone-500" />
                                <Input
                                    type="number"
                                    min="1"
                                    max="8"
                                    step="1"
                                    value={imageCount}
                                    onChange={(event) => onImageCountChange(event.target.value)}
                                    className="h-6 w-[22px] border-0 bg-transparent px-0 text-center text-[11px] font-semibold text-stone-900 shadow-none focus-visible:ring-0 sm:w-[42px] sm:text-sm dark:text-stone-100"
                                />
                            </div>
                        ) : null}

                        {mode !== "upscale" ? (
                            <>
                                <Select value={imageSize} onValueChange={(value) => onImageSizeChange(value as ToolbarImageSize)}>
                                    <SelectTrigger className="h-8 w-[96px] shrink-0 rounded-lg border-stone-200/80 bg-white px-1.5 text-[11px] font-medium text-stone-700 ring-1 ring-stone-900/5 transition-all hover:border-stone-300 focus-visible:ring-2 focus-visible:ring-stone-900/10 sm:w-[124px] sm:px-3 sm:text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700 dark:hover:border-stone-600">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {imageSizeOptions.map((item) => (
                                            <SelectItem key={item.value} value={item.value}>
                                                <div className="flex items-center gap-2">
                                                    {item.value === "auto" && <Ratio className="size-3.5 shrink-0" />}
                                                    {item.value === "1:1" && <Square className="size-3.5 shrink-0" />}
                                                    {item.value === "3:2" && <Monitor className="size-3.5 shrink-0" />}
                                                    {item.value === "2:3" && <RectangleVertical className="size-3.5 shrink-0" />}
                                                    {item.value === "16:9" && <Monitor className="size-3.5 shrink-0" />}
                                                    {item.value === "9:16" && <Smartphone className="size-3.5 shrink-0" />}
                                                    <span>{item.label}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={imageQuality} onValueChange={(value) => onImageQualityChange(value as ImageGenerationQuality)}>
                                    <SelectTrigger className="h-8 w-[60px] shrink-0 rounded-lg border-stone-200/80 bg-white px-1.5 text-[11px] font-medium text-stone-700 ring-1 ring-stone-900/5 transition-all hover:border-stone-300 focus-visible:ring-2 focus-visible:ring-stone-900/10 sm:w-[86px] sm:px-3 sm:text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700 dark:hover:border-stone-600">
                                        {renderQualityOption(
                                            imageQuality,
                                            imageQualityOptions.find((item) => item.value === imageQuality)?.label ?? "Auto",
                                        )}
                                    </SelectTrigger>
                                    <SelectContent>
                                        {imageQualityOptions.map((item) => (
                                            <SelectItem key={item.value} value={item.value}>
                                                {renderQualityOption(item.value, item.label)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}

                        {mode === "upscale" ? (
                            <Select value={upscaleQuality} onValueChange={(value) => onUpscaleQualityChange(value as ImageGenerationQuality)}>
                                <SelectTrigger className="h-8 w-[62px] shrink-0 rounded-lg border-stone-200/80 bg-white px-1.5 text-[11px] font-medium text-stone-700 shadow-sm ring-1 ring-stone-900/5 transition-all hover:border-stone-300 hover:shadow focus-visible:ring-2 focus-visible:ring-stone-900/10 sm:w-[92px] sm:px-3 sm:text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700 dark:hover:border-stone-600">
                                    {renderQualityOption(
                                        upscaleQuality,
                                        upscaleQualityOptions.find((item) => item.value === upscaleQuality)?.label ?? "Auto",
                                    )}
                                </SelectTrigger>
                                <SelectContent>
                                    {upscaleQualityOptions.map((item) => (
                                        <SelectItem key={item.value} value={item.value}>
                                            {renderQualityOption(item.value, item.label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : null}

                    </div>
                </div>

                <div
                    className="overflow-hidden rounded-[18px] border border-stone-200 bg-[#fafaf9] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-stone-700 dark:bg-stone-800"
                    onClick={() => {
                        textareaRef.current?.focus();
                    }}
                >
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
                            className="min-h-[36px] max-h-[180px] resize-none border-0 bg-transparent !px-0 !pt-0 !pb-0 text-[15px] leading-6 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:ring-0 overflow-y-auto dark:text-stone-100 dark:placeholder:text-stone-500"
                        />
                    </div>
                    <div className="px-2.5 pb-2.5 pt-1.5">
                        <div className="flex items-end justify-between gap-3">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                {mode === "generate" && canToggleLatestResultReference ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        aria-pressed={useLatestResultAsReference}
                                        className={cn(
                                            "h-8 rounded-full px-2.5 text-xs font-medium shadow-none",
                                            useLatestResultAsReference
                                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                                                : "border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300",
                                        )}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onToggleLatestResultReference();
                                        }}
                                    >
                                        <Sparkles className="size-3.5" />
                                        引用上张
                                    </Button>
                                ) : null}

                                {mode === "edit" ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-full border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 shadow-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onOpenMaskEditor();
                                        }}
                                    >
                                        <Upload className="size-3.5" />
                                        添加遮罩
                                    </Button>
                                ) : null}

                                {sourceImages.length > 0 ? (
                                    <div className="group/source hide-scrollbar relative flex h-12 min-w-0 max-w-full items-center gap-2 overflow-x-auto pr-11">
                                        {sourceImages.map((item) => (
                                            <div
                                                key={item.id}
                                                className="group/item relative h-12 shrink-0 overflow-hidden rounded-lg border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-150 hover:-translate-y-px hover:border-stone-300 hover:shadow-[0_4px_10px_rgba(15,23,42,0.14)] focus-within:border-stone-300 focus-within:shadow-[0_4px_10px_rgba(15,23,42,0.14)] dark:border-stone-700/80 dark:bg-stone-900 dark:hover:border-stone-600 dark:focus-within:border-stone-600"
                                            >
                                                <div className="block h-full">
                                                    <Image
                                                        src={item.dataUrl}
                                                        alt={item.name}
                                                        className="block h-full w-auto max-w-[136px] object-contain"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    title="移除图片"
                                                    className="absolute right-0.5 top-0.5 z-10 inline-flex size-5 items-center justify-center rounded-full bg-white/45 text-stone-700 opacity-0 transition hover:bg-white/70 hover:text-stone-950 group-hover/item:opacity-100 focus-visible:opacity-100 dark:bg-stone-950/35 dark:text-stone-200 dark:hover:bg-stone-950/60 dark:hover:text-white"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onRemoveSourceImage(item.id);
                                                    }}
                                                >
                                                    <X className="size-3" />
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            title={uploadLabel}
                                            aria-label={uploadLabel}
                                            className="absolute right-0 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-600 opacity-0 shadow-sm backdrop-blur transition hover:bg-stone-50 hover:text-stone-950 group-hover/source:opacity-100 focus-visible:opacity-100 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                uploadInputRef.current?.click();
                                            }}
                                        >
                                            <ImagePlus className="size-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        title={uploadLabel}
                                        aria-label={uploadLabel}
                                        className={cn(
                                            "inline-flex shrink-0 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50/70 text-stone-500 transition hover:border-stone-400 hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200",
                                            mode === "generate" ? "size-10" : "size-12",
                                        )}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            uploadInputRef.current?.click();
                                        }}
                                    >
                                        <ImagePlus className="size-4" />
                                    </button>
                                )}
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                                <div
                                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-stone-200/50 bg-stone-50/70 px-2 text-[11px] font-medium text-stone-500 shadow-none dark:border-stone-700/50 dark:bg-stone-800/45 dark:text-stone-400 sm:px-2.5"
                                    title="图片格式在设置页修改"
                                >
                                    <FileImage className="size-3.5" />
                                    <span className="whitespace-nowrap">{getImageFormatLabel(imageFormat)}</span>
                                </div>

                                <div className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-stone-200/50 bg-stone-50/70 px-2 text-[11px] font-medium text-stone-500 shadow-none dark:border-stone-700/50 dark:bg-stone-800/45 dark:text-stone-400 sm:px-2.5">
                                    <span className="hidden whitespace-nowrap sm:inline">额度</span>
                                    <span className="whitespace-nowrap text-stone-700 dark:text-stone-200">{availableQuota}</span>
                                </div>

                                {isSubmitting ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={onCancel}
                                        title={cancelButtonTitle}
                                        className="h-9 shrink-0 rounded-full bg-stone-950 px-3 text-xs font-medium text-white shadow-none transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
                                    >
                                        <LoaderCircle className="size-3.5 animate-spin" />
                                        {cancelButtonLabel}
                                    </Button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={onSubmit}
                                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
                                        aria-label="提交图片任务"
                                    >
                                        <ArrowUp className="size-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
                        multiple={mode !== "upscale"}
                        className="hidden"
                        onChange={(event) => {
                            onUploadFiles(event.target.files);
                            event.currentTarget.value = "";
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
