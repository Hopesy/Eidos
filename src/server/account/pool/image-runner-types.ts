import type { ImageGenerationQuality, ImageGenerationSize } from "@/lib/api";
import type { AccountRecord } from "@/server/types";

export type AccountPoolImageRunnerDependencies = {
  getAvailableAccessToken(excludedTokens?: Set<string>): Promise<string>;
  getAccount(accessToken: string): Promise<AccountRecord | null>;
  markImageResult(accessToken: string, success: boolean): Promise<unknown>;
  removeToken(accessToken: string): Promise<unknown>;
};

export type AccountPoolImageRunner = {
  generate(
    prompt: string,
    model: string,
    count: number,
    options?: {
      route?: string;
      operation?: string;
      imageSize?: ImageGenerationSize;
      imageQuality?: ImageGenerationQuality;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
  edit(
    prompt: string,
    model: string,
    images: File[],
    mask?: File | null,
    options?: {
      imageSize?: ImageGenerationSize;
      imageQuality?: ImageGenerationQuality;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
  upscale(
    prompt: string,
    model: string,
    image: File,
    options?: {
      imageQuality?: ImageGenerationQuality;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
};
