import { randomUUID } from "node:crypto";

import { captureBuildInfoFromHtml, getPowConfig, getProofToken, getRequirementsToken } from "@/server/providers/openai-proof";
import type { AccountRecord } from "@/server/types";

const BASE_URL = "https://chatgpt.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_MODEL = "gpt-4o";

export class ImageGenerationError extends Error {}

type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

class CookieSession {
  private readonly cookies = new Map<string, string>();
  private readonly defaultHeaders: HeadersInit;

  constructor(defaultHeaders: HeadersInit = {}) {
    this.defaultHeaders = defaultHeaders;
  }

  private applyResponseCookies(response: Response) {
    const headerBag = response.headers as Headers & { getSetCookie?: () => string[] };
    const rawCookies = headerBag.getSetCookie?.() ?? [];
    for (const item of rawCookies) {
      const [cookiePart] = item.split(";", 1);
      const [name, ...rest] = cookiePart.split("=");
      if (!name || rest.length === 0) {
        continue;
      }
      this.cookies.set(name.trim(), rest.join("=").trim());
    }
  }

  private buildCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  async fetch(url: string, options: FetchOptions = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
    const headers = new Headers(this.defaultHeaders);
    const nextHeaders = new Headers(options.headers ?? {});
    for (const [key, value] of nextHeaders.entries()) {
      headers.set(key, value);
    }
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      this.applyResponseCookies(response);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

function resolveFingerprint(account?: AccountRecord | null) {
  const fp = ((account?.fp as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  return {
    userAgent: cleanToken(fp["user-agent"] || account?.["user-agent"]) || USER_AGENT,
    deviceId: cleanToken(fp["oai-device-id"] || account?.["oai-device-id"]) || randomUUID(),
    secChUa:
      cleanToken(fp["sec-ch-ua"] || account?.["sec-ch-ua"]) ||
      '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    secChUaMobile: cleanToken(fp["sec-ch-ua-mobile"] || account?.["sec-ch-ua-mobile"]) || "?0",
    secChUaPlatform: cleanToken(fp["sec-ch-ua-platform"] || account?.["sec-ch-ua-platform"]) || '"Windows"',
    sessionId: cleanToken(fp["oai-session-id"] || account?.["oai-session-id"]),
  };
}

export function isTokenInvalidError(message: string) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("token_invalidated") ||
    normalized.includes("token_revoked") ||
    normalized.includes("authentication token has been invalidated") ||
    normalized.includes("invalidated oauth token")
  );
}

export function resolveUpstreamModel(account: AccountRecord | null, requestedModel: string) {
  const normalized = cleanToken(requestedModel) || "gpt-image-1";
  const isFreeAccount = cleanToken(account?.type || "Free") === "Free";
  if (normalized === "gpt-image-1") {
    return "auto";
  }
  if (normalized === "gpt-image-2") {
    return isFreeAccount ? "auto" : "gpt-5-3";
  }
  return normalized || DEFAULT_MODEL;
}

async function bootstrap(session: CookieSession, fingerprint: ReturnType<typeof resolveFingerprint>) {
  const response = await session.fetch(`${BASE_URL}/`, { timeoutMs: 30000 });
  const html = await response.text();
  captureBuildInfoFromHtml(html);
  return fingerprint.deviceId;
}

async function getChatRequirements(session: CookieSession, accessToken: string, deviceId: string, userAgent: string) {
  const config = getPowConfig(userAgent);
  const response = await session.fetch(`${BASE_URL}/backend-api/sentinel/chat-requirements`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "oai-device-id": deviceId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p: getRequirementsToken(config) }),
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new ImageGenerationError((await response.text()).slice(0, 400) || `chat-requirements failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    token: string;
    proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
  };

  return {
    chatToken: payload.token,
    pow: payload.proofofwork || {},
    powConfig: config,
  };
}

function parseSsePayload(raw: string) {
  const fileIds: string[] = [];
  let conversationId = "";
  const textParts: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    for (const [prefix, storedPrefix] of [
      ["file-service://", ""],
      ["sediment://", "sed:"],
    ] as const) {
      let cursor = 0;
      while (cursor >= 0) {
        const start = payload.indexOf(prefix, cursor);
        if (start < 0) {
          break;
        }
        cursor = start + prefix.length;
        const tail = payload.slice(cursor);
        const normalized = storedPrefix + (tail.match(/^[A-Za-z0-9_-]+/)?.[0] ?? "");
        if (normalized && !fileIds.includes(normalized)) {
          fileIds.push(normalized);
        }
      }
    }

    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      conversationId = String(json.conversation_id || conversationId);
      const nested = json.v;
      if (nested && typeof nested === "object") {
        conversationId = String((nested as Record<string, unknown>).conversation_id || conversationId);
      }
      const message = (json.message as Record<string, unknown> | undefined) ?? {};
      const content = (message.content as Record<string, unknown> | undefined) ?? {};
      if (content.content_type === "text" && Array.isArray(content.parts) && content.parts.length > 0) {
        textParts.push(String(content.parts[0] || ""));
      }
    } catch {
      continue;
    }
  }

  return {
    conversationId,
    fileIds,
    text: textParts.join(""),
  };
}

function extractImageIds(mapping: Record<string, unknown>) {
  const fileIds: string[] = [];
  for (const node of Object.values(mapping)) {
    const message = ((node as Record<string, unknown> | undefined)?.message ?? {}) as Record<string, unknown>;
    const author = (message.author ?? {}) as Record<string, unknown>;
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const content = (message.content ?? {}) as Record<string, unknown>;

    if (author.role !== "tool" || metadata.async_task_type !== "image_gen" || content.content_type !== "multimodal_text") {
      continue;
    }

    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      const pointer = String((part as Record<string, unknown>)?.asset_pointer || "");
      if (pointer.startsWith("file-service://")) {
        const fileId = pointer.replace("file-service://", "");
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      } else if (pointer.startsWith("sediment://")) {
        const fileId = `sed:${pointer.replace("sediment://", "")}`;
        if (fileId && !fileIds.includes(fileId)) {
          fileIds.push(fileId);
        }
      }
    }
  }
  return fileIds;
}

async function pollImageIds(session: CookieSession, accessToken: string, deviceId: string, conversationId: string) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const response = await session.fetch(`${BASE_URL}/backend-api/conversation/${conversationId}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
        accept: "*/*",
      },
      timeoutMs: 30000,
    });

    if (response.ok) {
      const payload = (await response.json()) as { mapping?: Record<string, unknown> };
      const fileIds = extractImageIds(payload.mapping || {});
      if (fileIds.length > 0) {
        return fileIds;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return [] as string[];
}

async function sendConversation(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  chatToken: string,
  proofToken: string | null,
  prompt: string,
  model: string,
) {
  const response = await session.fetch(`${BASE_URL}/backend-api/conversation`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "text/event-stream",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "content-type": "application/json",
      "oai-device-id": deviceId,
      "oai-language": "zh-CN",
      "oai-client-build-number": "5955942",
      "oai-client-version": "prod-be885abbfcfe7b1f511e88b3003d9ee44757fbad",
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
      "openai-sentinel-chat-requirements-token": chatToken,
      ...(proofToken ? { "openai-sentinel-proof-token": proofToken } : {}),
    },
    body: JSON.stringify({
      action: "next",
      messages: [
        {
          id: randomUUID(),
          author: { role: "user" },
          content: { content_type: "text", parts: [prompt] },
          metadata: { attachments: [] },
        },
      ],
      parent_message_id: randomUUID(),
      model,
      history_and_training_disabled: false,
      timezone_offset_min: -480,
      timezone: "America/Los_Angeles",
      conversation_mode: { kind: "primary_assistant" },
      websocket_request_id: randomUUID(),
      force_paragen: false,
      force_use_sse: true,
      system_hints: ["picture_v2"],
      supported_encodings: [],
      client_contextual_info: {
        is_dark_mode: false,
        time_since_loaded: 120,
        page_height: 900,
        page_width: 1600,
        pixel_ratio: 1.2,
        screen_height: 1080,
        screen_width: 1920,
      },
    }),
    timeoutMs: 180000,
  });

  if (!response.ok) {
    throw new ImageGenerationError((await response.text()).slice(0, 400) || `conversation failed: ${response.status}`);
  }

  return response;
}

async function fetchDownloadUrl(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  conversationId: string,
  fileId: string,
) {
  const isSediment = fileId.startsWith("sed:");
  const rawId = isSediment ? fileId.slice(4) : fileId;
  const endpoint = isSediment
    ? `${BASE_URL}/backend-api/conversation/${conversationId}/attachment/${rawId}/download`
    : `${BASE_URL}/backend-api/files/${rawId}/download`;

  const response = await session.fetch(endpoint, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "oai-device-id": deviceId,
    },
    timeoutMs: 30000,
  });

  if (!response.ok) {
    return "";
  }

  const payload = (await response.json()) as { download_url?: string };
  return String(payload.download_url || "");
}

async function downloadAsBase64(session: CookieSession, downloadUrl: string) {
  const response = await session.fetch(downloadUrl, { timeoutMs: 60000 });
  if (!response.ok) {
    throw new ImageGenerationError("download image failed");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new ImageGenerationError("download image failed");
  }
  return bytes.toString("base64");
}

export async function fetchRemoteAccountInfo(accessToken: string, account: AccountRecord | null) {
  const fingerprint = resolveFingerprint(account);
  const session = new CookieSession({
    accept: "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "oai-language": "zh-CN",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": fingerprint.userAgent,
    "sec-ch-ua": fingerprint.secChUa,
    "sec-ch-ua-mobile": fingerprint.secChUaMobile,
    "sec-ch-ua-platform": fingerprint.secChUaPlatform,
    ...(fingerprint.sessionId ? { "oai-session-id": fingerprint.sessionId } : {}),
  });

  const deviceId = fingerprint.deviceId;
  const meHeaders = {
    authorization: `Bearer ${accessToken}`,
    "oai-device-id": deviceId,
    "x-openai-target-path": "/backend-api/me",
    "x-openai-target-route": "/backend-api/me",
  };

  const initHeaders = {
    authorization: `Bearer ${accessToken}`,
    "oai-device-id": deviceId,
  };

  const [meResponse, initResponse] = await Promise.all([
    session.fetch(`${BASE_URL}/backend-api/me`, {
      headers: meHeaders,
      timeoutMs: 20000,
    }),
    session.fetch(`${BASE_URL}/backend-api/conversation/init`, {
      method: "POST",
      headers: initHeaders,
      body: JSON.stringify({
        gizmo_id: null,
        requested_default_model: null,
        conversation_id: null,
        timezone_offset_min: -480,
      }),
      timeoutMs: 20000,
    }),
  ]);

  if (!meResponse.ok) {
    throw new Error(`/backend-api/me failed: HTTP ${meResponse.status}`);
  }
  if (!initResponse.ok) {
    throw new Error(`/backend-api/conversation/init failed: HTTP ${initResponse.status}`);
  }

  return {
    mePayload: (await meResponse.json()) as Record<string, unknown>,
    initPayload: (await initResponse.json()) as Record<string, unknown>,
  };
}

export async function generateImageResult(
  accessToken: string,
  prompt: string,
  requestedModel: string,
  account: AccountRecord | null,
) {
  const normalizedPrompt = cleanToken(prompt);
  const normalizedToken = cleanToken(accessToken);
  if (!normalizedPrompt) {
    throw new ImageGenerationError("prompt is required");
  }
  if (!normalizedToken) {
    throw new ImageGenerationError("token is required");
  }

  const fingerprint = resolveFingerprint(account);
  const upstreamModel = resolveUpstreamModel(account, requestedModel);
  const session = new CookieSession({
    "user-agent": fingerprint.userAgent,
    "accept-language": "en-US,en;q=0.9",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    accept: "*/*",
    "sec-ch-ua": fingerprint.secChUa,
    "sec-ch-ua-mobile": fingerprint.secChUaMobile,
    "sec-ch-ua-platform": fingerprint.secChUaPlatform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "oai-device-id": fingerprint.deviceId,
    ...(fingerprint.sessionId ? { "oai-session-id": fingerprint.sessionId } : {}),
  });

  const deviceId = await bootstrap(session, fingerprint);
  const { chatToken, pow, powConfig } = await getChatRequirements(session, normalizedToken, deviceId, fingerprint.userAgent);
  const proofToken =
    pow.required && pow.seed && pow.difficulty
      ? getProofToken(String(pow.seed), String(pow.difficulty), fingerprint.userAgent, powConfig)
      : null;
  const response = await sendConversation(session, normalizedToken, deviceId, chatToken, proofToken, normalizedPrompt, upstreamModel);
  const parsed = parseSsePayload(await response.text());
  const conversationId = parsed.conversationId || "";
  let fileIds = parsed.fileIds;
  if (conversationId && fileIds.length === 0) {
    fileIds = await pollImageIds(session, normalizedToken, deviceId, conversationId);
  }
  if (fileIds.length === 0) {
    throw new ImageGenerationError(parsed.text || "no image returned from upstream");
  }

  const downloadUrl = await fetchDownloadUrl(session, normalizedToken, deviceId, conversationId, fileIds[0]);
  if (!downloadUrl) {
    throw new ImageGenerationError("failed to get download url");
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: [
      {
        b64_json: await downloadAsBase64(session, downloadUrl),
        revised_prompt: normalizedPrompt,
      },
    ],
  };
}
