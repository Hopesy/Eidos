import type { ImageMode } from "@/store/image-conversations";

import type { ActiveRequestState } from "./utils";

export function formatProcessingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function buildWaitingDots(totalSeconds: number) {
  return ".".repeat((totalSeconds % 3) + 1);
}

export function buildProcessingStatus(
  mode: ImageMode,
  elapsedSeconds: number,
  count: number,
  variant: ActiveRequestState["variant"],
) {
  if (mode === "generate") {
    if (elapsedSeconds < 4) {
      return {
        title: "正在提交生成请求",
        detail: `已进入图像生成队列，本次目标 ${count} 张`,
      };
    }
    if (elapsedSeconds < 12) {
      return {
        title: `正在生成图像${buildWaitingDots(elapsedSeconds)}`,
        detail: `模型正在组织画面内容，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
      };
    }
    return {
      title: `正在生成图像${buildWaitingDots(elapsedSeconds)}`,
      detail: `复杂提示词会耗时更久，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
    };
  }

  if (mode === "edit") {
    if (variant === "selection-edit") {
      if (elapsedSeconds < 6) {
        return {
          title: "正在提交选区编辑",
          detail: `遮罩与源图已上传，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
        };
      }
      return {
        title: `正在执行选区编辑${buildWaitingDots(elapsedSeconds)}`,
        detail: `系统正在根据遮罩重绘区域，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
      };
    }

    if (elapsedSeconds < 6) {
      return {
        title: "正在提交编辑请求",
        detail: `源图已就绪，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
      };
    }
    return {
      title: `正在编辑图像${buildWaitingDots(elapsedSeconds)}`,
      detail: `系统正在重绘并融合结果，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
    };
  }

  if (elapsedSeconds < 5) {
    return {
      title: "正在提交增强任务",
      detail: `源图已上传，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
    };
  }
  return {
    title: `正在增强图像${buildWaitingDots(elapsedSeconds)}`,
    detail: `系统正在增强清晰度与细节，已等待 ${formatProcessingDuration(elapsedSeconds)}`,
  };
}
