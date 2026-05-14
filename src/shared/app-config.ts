import type { ImageOutputFormat } from "@/lib/api";

export type ConfigPayload = {
  chatgpt?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    apiStyle?: "v1" | "responses";
    responsesModel?: string;
    imageFormat?: ImageOutputFormat;
    [key: string]: unknown;
  };
  accounts?: {
    autoRefresh?: boolean;
    refreshInterval?: number;
    [key: string]: unknown;
  };
  sync?: {
    enabled?: boolean;
    provider?: string;
    interval?: number;
    direction?: "pull" | "push" | "both";
    [key: string]: unknown;
  };
  proxy?: {
    enabled?: boolean;
    url?: string;
    [key: string]: unknown;
  };
  cpa?: {
    enabled?: boolean;
    baseUrl?: string;
    managementKey?: string;
    providerType?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function getDefaultConfigPayload(): ConfigPayload {
  return {
    chatgpt: {
      enabled: false,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      apiStyle: "v1",
      responsesModel: "gpt-5.5",
      imageFormat: "png",
    },
    accounts: {
      autoRefresh: true,
      refreshInterval: 5,
    },
    sync: {
      enabled: false,
      provider: "codex",
      direction: "both",
      interval: 300,
    },
    proxy: {
      enabled: false,
      url: "",
    },
    cpa: {
      enabled: false,
      baseUrl: "",
      managementKey: "",
      providerType: "codex",
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

function normalizeImageFormat(value: unknown): ImageOutputFormat {
  const normalized = String(value || "png").trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "webp") {
    return normalized;
  }
  return "png";
}

function normalizeAccountRefreshInterval(value: unknown, fallback: number) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) {
    return fallback;
  }
  return Math.max(1, Math.min(1440, Math.trunc(interval)));
}

export function sanitizeConfigPayload(value: Record<string, unknown> | null | undefined): ConfigPayload {
  const defaults = getDefaultConfigPayload();
  const source = asRecord(value);

  delete source.image;
  delete source.app;
  delete source.server;
  delete source.log;

  const chatgpt = asRecord(source.chatgpt);
  delete chatgpt.timeout;
  const accounts = asRecord(source.accounts);
  delete accounts.defaultQuota;

  return {
    ...defaults,
    ...source,
    chatgpt: {
      ...defaults.chatgpt,
      ...chatgpt,
      imageFormat: normalizeImageFormat(chatgpt.imageFormat ?? defaults.chatgpt?.imageFormat),
    },
    accounts: {
      ...defaults.accounts,
      ...accounts,
      autoRefresh: typeof accounts.autoRefresh === "boolean" ? accounts.autoRefresh : defaults.accounts?.autoRefresh,
      refreshInterval: normalizeAccountRefreshInterval(
        accounts.refreshInterval ?? defaults.accounts?.refreshInterval,
        defaults.accounts?.refreshInterval ?? 5,
      ),
    },
    sync: {
      ...defaults.sync,
      ...asRecord(source.sync),
    },
    proxy: {
      ...defaults.proxy,
      ...asRecord(source.proxy),
    },
    cpa: {
      ...defaults.cpa,
      ...asRecord(source.cpa),
    },
  };
}
