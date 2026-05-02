import { z } from "zod";

import { ApiError } from "@/server/response";

export const stringListSchema = z.array(z.string()).default([]);

export const tokenListBodySchema = z.object({
  tokens: stringListSchema.optional(),
});

export const accessTokenListBodySchema = z.object({
  access_tokens: stringListSchema.optional(),
});

export const syncDirectionBodySchema = z.object({
  direction: z.enum(["pull", "push", "both"]),
});

export const imageQualitySchema = z.enum(["auto", "low", "medium", "high"]);
export const imageSizeSchema = z.enum(["auto", "1024x1024", "1536x1024", "1024x1536", "256x256", "512x512", "1792x1024", "1024x1792"]);

export const imageGenerationBodySchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required"),
  model: z.string().trim().optional(),
  n: z.number().int().optional(),
  response_format: z.string().optional(),
  size: imageSizeSchema.optional(),
  quality: imageQualitySchema.optional(),
});

export const imageTaskRecoverBodySchema = z.object({
  conversationId: z.string().trim().min(1, "conversationId is required"),
  sourceAccountId: z.string().trim().optional(),
  revisedPrompt: z.string().trim().optional(),
  fileIds: stringListSchema.optional(),
  waitMs: z.number().positive().optional(),
  model: z.string().trim().optional(),
  mode: z.enum(["generate", "edit", "upscale"]).optional(),
});

export const accountTypeSchema = z.enum(["Free", "Plus", "Pro", "Team"]);
export const accountStatusSchema = z.enum(["正常", "限流", "异常", "禁用"]);

export const accountUpdateBodySchema = z.object({
  access_token: z.string().trim().min(1, "access_token is required"),
  type: accountTypeSchema.optional(),
  status: accountStatusSchema.optional(),
  quota: z.number().int().nonnegative().optional(),
});

export const recordBodySchema = z.record(z.string(), z.unknown());

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "invalid json body");
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(400, "invalid request body", {
      error: "invalid request body",
      issues: z.flattenError(result.error).fieldErrors,
    });
  }
  return result.data;
}

export function cleanStringList(values: string[] | undefined) {
  return (values ?? []).map((item) => item.trim()).filter(Boolean);
}
