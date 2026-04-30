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
