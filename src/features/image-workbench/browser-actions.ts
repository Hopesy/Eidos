import { toast } from "sonner";

import type { StoredImage } from "@/store/image-conversations";

import { buildImageDataUrl } from "./utils";

export function openImageInNewTab(dataUrl: string) {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(`<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${dataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain" /></body></html>`);
    w.document.close();
  }
}

export async function downloadImageFile(image: StoredImage, suggestedFileName: string) {
  const href = image.url || buildImageDataUrl(image);
  if (!href) {
    toast.error("当前图片没有可下载的数据");
    return;
  }

  const fileName = suggestedFileName || "image.png";
  try {
    const response = await fetch(href);
    if (!response.ok) {
      throw new Error(`下载图片失败 (${response.status})`);
    }
    const blob = await response.blob();

    const picker = (window as Window & {
      showSaveFilePicker?: (options?: {
        suggestedName?: string;
        startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
        types?: Array<{
          description?: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }).showSaveFilePicker;

    if (typeof picker === "function") {
      const ext = fileName.includes(".") ? `.${fileName.split(".").pop()}` : ".png";
      const handle = await picker({
        suggestedName: fileName,
        startIn: "desktop",
        types: [
          {
            description: "图片文件",
            accept: {
              [blob.type || "image/png"]: [ext],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    toast.error(error instanceof Error ? error.message : "下载图片失败");
  }
}
