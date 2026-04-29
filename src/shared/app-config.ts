export type ConfigPayload = {
  chatgpt?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    apiStyle?: "v1" | "responses";
    responsesModel?: string;
    [key: string]: unknown;
  };
  accounts?: {
    defaultQuota?: number;
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
    },
    accounts: {
      defaultQuota: 50,
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

export function sanitizeConfigPayload(value: Record<string, unknown> | null | undefined): ConfigPayload {
  const defaults = getDefaultConfigPayload();
  const source = asRecord(value);

  delete source.image;
  delete source.app;
  delete source.server;
  delete source.log;

  const chatgpt = asRecord(source.chatgpt);
  delete chatgpt.timeout;

  return {
    ...defaults,
    ...source,
    chatgpt: {
      ...defaults.chatgpt,
      ...chatgpt,
    },
    accounts: {
      ...defaults.accounts,
      ...asRecord(source.accounts),
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
