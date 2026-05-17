import type { ImageGenerationQuality, ImageGenerationSize, ImageOutputFormat } from "@/lib/api";
import type { ImagePipelineStage } from "@/server/providers/openai/image-errors";
import type { AccountRecord } from "@/server/types";

export type AccountPoolImageRunnerDependencies = {
  getAvailableAccessToken(excludedTokens?: Set<string>): Promise<string>;
  getAccount(accessToken: string): Promise<AccountRecord | null>;
  getAccountById(accountId: string): Promise<AccountRecord | null>;
  markImageResult(
    accessToken: string,
    success: boolean,
    options?: { stage?: ImagePipelineStage },
  ): Promise<unknown>;
  removeToken(accessToken: string): Promise<unknown>;
};

export type UpstreamConversationContext = {
  conversationId?: string;
  parentMessageId?: string;
  sourceAccountId?: string;
};

export type AccountPoolSourceReference = {
  originalFileId?: string;
  originalGenId?: string;
  previousResponseId?: string;
  imageGenerationCallId?: string;
  conversationId?: string;
  parentMessageId?: string;
  sourceAccountId?: string;
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
      imageFormat?: ImageOutputFormat;
      upstreamContext?: UpstreamConversationContext;
      signal?: AbortSignal;
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
      imageFormat?: ImageOutputFormat;
      sourceReference?: AccountPoolSourceReference | null;
      signal?: AbortSignal;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
  upscale(
    prompt: string,
    model: string,
    image: File,
    options?: {
      imageSize?: ImageGenerationSize;
      imageQuality?: ImageGenerationQuality;
      imageFormat?: ImageOutputFormat;
      sourceReference?: AccountPoolSourceReference | null;
      signal?: AbortSignal;
    },
  ): Promise<{ created: number; data: Array<Record<string, unknown>> }>;
};
