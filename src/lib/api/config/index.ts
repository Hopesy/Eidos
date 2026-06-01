import { httpRequest } from "@/lib/request";
import type { ConfigPayload } from "@/shared/app-config";

export type { ConfigPayload } from "@/shared/app-config";

export async function fetchConfig() {
  return httpRequest<ConfigPayload>("/api/config");
}

export async function fetchDefaultConfig() {
  return httpRequest<ConfigPayload>("/api/config/defaults");
}

export async function updateConfig(config: ConfigPayload) {
  return httpRequest<ConfigPayload>("/api/config", {
    method: "PUT",
    body: config,
  });
}

export type TestImageApiResult = {
  ok: boolean;
  status?: number;
  endpoint: string;
  durationMs: number;
  message: string;
  hint?: string;
};

export async function testImageApi(input: { baseUrl: string; apiKey: string }) {
  return httpRequest<TestImageApiResult>("/api/config/test-image-api", {
    method: "POST",
    body: input,
  });
}

export type ImageModelListItem = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export type ImageModelListResult = {
  object: "list";
  data: ImageModelListItem[];
};

export async function fetchConfiguredImageModels() {
  return httpRequest<ImageModelListResult>("/v1/models");
}

export async function fetchImageModels(input: { baseUrl: string; apiKey: string }) {
  return httpRequest<ImageModelListResult>("/api/config/image-models", {
    method: "POST",
    body: input,
  });
}
