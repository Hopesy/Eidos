import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";

export type ImageRatioOption = "auto" | "1:1" | "3:2" | "2:3" | "16:9" | "9:16";

export function getUpscaleQualityLabel(quality: ImageGenerationQuality) {
  switch (quality) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    default:
      return "Auto";
  }
}

export function buildImageGenerationQualityInstruction(quality: ImageGenerationQuality) {
  switch (quality) {
    case "low":
      return "请以低耗时预览画质快速出图，分辨率按 1K 档位控制。";
    case "medium":
      return "请以中高细节和清晰画质完成最终渲染，分辨率按 2K 档位控制。";
    case "high":
      return "请以极高细节、超清画质完成最终渲染，分辨率按 4K 档位控制。";
    default:
      return "";
  }
}

export function resolveUpscaleQuality(rawQuality?: unknown, rawLegacyScale?: unknown): ImageGenerationQuality {
  const quality = String(rawQuality || "").trim().toLowerCase();
  if (quality === "auto" || quality === "low" || quality === "medium" || quality === "high") {
    return quality;
  }

  switch (String(rawLegacyScale || "").trim().toLowerCase()) {
    case "2x":
      return "low";
    case "4x":
      return "medium";
    case "6x":
    case "8x":
      return "high";
    default:
      return "medium";
  }
}

export function resolveImageGenerationSize(
  ratio: ImageRatioOption,
  quality: ImageGenerationQuality,
): ImageGenerationSize {
  if (ratio === "auto") {
    switch (quality) {
      case "low":
        return "1024x1024";
      case "medium":
        return "2048x2048";
      case "high":
        return "4096x4096";
      default:
        return "auto";
    }
  }

  if (quality === "auto") {
    return "auto";
  }

  const key = `${ratio}:${quality}` as const;
  const mapping: Record<string, ImageGenerationSize> = {
    "1:1:low": "1024x1024",
    "1:1:medium": "2048x2048",
    "1:1:high": "4096x4096",
    "3:2:low": "1536x1024",
    "3:2:medium": "3072x2048",
    "3:2:high": "6144x4096",
    "2:3:low": "1024x1536",
    "2:3:medium": "2048x3072",
    "2:3:high": "4096x6144",
    "16:9:low": "1920x1088",
    "16:9:medium": "2560x1440",
    "16:9:high": "3840x2160",
    "9:16:low": "1088x1920",
    "9:16:medium": "1440x2560",
    "9:16:high": "2160x3840",
  };
  return mapping[key] ?? "auto";
}

export function resolveImageRatioFromSize(size?: ImageGenerationSize): ImageRatioOption {
  switch (size) {
    case "1024x1024":
    case "2048x2048":
    case "4096x4096":
      return "1:1";
    case "1536x1024":
    case "3072x2048":
    case "6144x4096":
      return "3:2";
    case "1024x1536":
    case "2048x3072":
    case "4096x6144":
      return "2:3";
    case "1920x1088":
    case "2560x1440":
    case "3840x2160":
      return "16:9";
    case "1088x1920":
    case "1440x2560":
    case "2160x3840":
      return "9:16";
    default:
      return "auto";
  }
}

export function buildUpscalePrompt(prompt: string, quality: ImageGenerationQuality) {
  const qualityInstruction =
    quality === "low"
      ? "增强档位使用 1K，做保守增强，优先快速提高清晰度。"
      : quality === "medium"
        ? "增强档位使用 2K，明显提升材质纹理、边缘细节与整体清晰度。"
        : quality === "high"
          ? "增强档位使用 4K，尽可能拉高细节密度、材质表现与成片清晰度。"
          : "";

  return [
    "请基于上传源图进行高清增强，而不是重绘为全新构图。",
    "保持主体构图、风格、颜色与关键细节一致，优先提升清晰度、材质纹理、边缘细节与整体分辨率表现。",
    qualityInstruction,
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}
