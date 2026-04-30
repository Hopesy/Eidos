import { getSavedConfig } from "@/server/repositories/config";
import { ApiError } from "@/server/response";

import {
  type CpaConfig,
  type RemoteAuthFileInfo,
  type RemoteAuthPayload,
  type SavedCpaConfigShape,
  normalizeProvider,
  normalizeToken,
} from "./shared";

const DEFAULT_TIMEOUT_MS = 10_000;

export async function getCpaConfig(): Promise<CpaConfig> {
  const savedConfig = getSavedConfig() as SavedCpaConfigShape | null;
  const syncEnabled = Boolean(savedConfig?.sync?.enabled);
  const cpaEnabled = Boolean(savedConfig?.cpa?.enabled);
  const provider = normalizeProvider(savedConfig?.sync?.provider);
  const providerType = String(
    savedConfig?.cpa?.providerType ||
      provider ||
      process.env.CPA_PROVIDER_TYPE ||
      "codex",
  ).trim();
  const baseUrl = String(
    savedConfig?.cpa?.baseUrl || process.env.CPA_BASE_URL || "",
  )
    .trim()
    .replace(/\/+$/, "");
  const managementKey = String(
    savedConfig?.cpa?.managementKey || process.env.CPA_MANAGEMENT_KEY || "",
  ).trim();

  return {
    enabled:
      (syncEnabled || cpaEnabled || Boolean(baseUrl)) &&
      Boolean(baseUrl && managementKey),
    baseUrl,
    managementKey,
    providerType,
  };
}

export class CpaClient {
  constructor(private readonly config: CpaConfig) {}

  configured() {
    return (
      this.config.enabled &&
      Boolean(this.config.baseUrl) &&
      Boolean(this.config.managementKey)
    );
  }

  private async request(path: string, init: RequestInit = {}) {
    if (!this.configured()) {
      throw new ApiError(400, "CPA sync is not configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.managementKey}`,
          ...(init.headers || {}),
        },
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(504, "CPA 请求超时");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private matchesProvider(info: RemoteAuthFileInfo) {
    const expected = normalizeProvider(this.config.providerType);
    if (!expected) {
      return true;
    }
    return [info.type, info.provider].some(
      (value) =>
        normalizeProvider(value) === expected ||
        normalizeProvider(value) === "",
    );
  }

  async listAuthFiles() {
    const response = await this.request("/v0/management/auth-files", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        `列出 CPA auth-files 失败：${await response.text()}`,
      );
    }

    const payload = (await response.json()) as { files?: RemoteAuthFileInfo[] };
    return (payload.files || []).filter((item) => this.matchesProvider(item));
  }

  async downloadAuthFile(name: string) {
    const response = await this.request(
      `/v0/management/auth-files/download?name=${encodeURIComponent(name)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(response.status, `下载 CPA auth-file 失败：${text}`);
    }
    return text;
  }

  async uploadAuthFile(name: string, content: string) {
    const formData = new FormData();
    formData.append("file", new Blob([content], { type: "application/json" }), name);
    const response = await this.request("/v0/management/auth-files", {
      method: "POST",
      body: formData,
    });
    if (![200, 201, 409].includes(response.status)) {
      throw new ApiError(
        response.status,
        `上传 CPA auth-file 失败：${await response.text()}`,
      );
    }
  }

  async patchAuthFileStatus(name: string, disabled: boolean) {
    const response = await this.request("/v0/management/auth-files/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, disabled }),
    });
    if (![200, 204].includes(response.status)) {
      throw new ApiError(
        response.status,
        `更新 CPA auth-file 状态失败：${await response.text()}`,
      );
    }
  }
}

export async function loadRemoteAuthFiles(client: CpaClient) {
  const files = await client.listAuthFiles();
  const byToken = new Map<string, RemoteAuthPayload>();

  for (const file of files) {
    try {
      const content = await client.downloadAuthFile(file.name);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const accessToken = normalizeToken(parsed.access_token);
      if (!accessToken) {
        continue;
      }
      byToken.set(accessToken, {
        name: file.name,
        accessToken,
        email: normalizeToken(parsed.email) || file.email || null,
        disabled: Boolean(parsed.disabled ?? file.disabled),
        raw: parsed,
        meta: file,
      });
    } catch {
      continue;
    }
  }

  return byToken;
}
