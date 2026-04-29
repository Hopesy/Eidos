import { randomUUID } from "node:crypto";

import { logger } from "@/server/logger";
import {
  buildHttpImageError,
  createImageError,
} from "@/server/providers/openai-image-errors";
import { captureBuildInfoFromHtml, getPowConfig, getRequirementsToken } from "@/server/providers/openai-proof";
import type { AccountRecord } from "@/server/types";

export const CHATGPT_BASE_URL = "https://chatgpt.com";
export const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const DEFAULT_CHATGPT_IMAGE_MODEL = "gpt-4o";

export type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

export type ChatGptFingerprint = ReturnType<typeof resolveFingerprint>;

export function cleanToken(value: unknown) {
  return String(value || "").trim();
}

export function maskAccessToken(accessToken: string) {
  const normalized = cleanToken(accessToken);
  if (!normalized) {
    return "";
  }
  return normalized.length <= 16 ? normalized : `${normalized.slice(0, 16)}...`;
}

export class CookieSession {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const label = isAbort ? "request timed out" : `network error: ${message}`;
      throw createImageError(label, {
        kind: "submit_failed",
        retryAction: "resubmit",
        retryable: true,
        stage: "submit",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function resolveFingerprint(account?: AccountRecord | null) {
  const fp = ((account?.fp as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  return {
    userAgent: cleanToken(fp["user-agent"] || account?.["user-agent"]) || CHATGPT_USER_AGENT,
    deviceId: cleanToken(fp["oai-device-id"] || account?.["oai-device-id"]) || randomUUID(),
    secChUa:
      cleanToken(fp["sec-ch-ua"] || account?.["sec-ch-ua"]) ||
      '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    secChUaMobile: cleanToken(fp["sec-ch-ua-mobile"] || account?.["sec-ch-ua-mobile"]) || "?0",
    secChUaPlatform: cleanToken(fp["sec-ch-ua-platform"] || account?.["sec-ch-ua-platform"]) || '"Windows"',
    sessionId: cleanToken(fp["oai-session-id"] || account?.["oai-session-id"]),
  };
}

export function createChatGptSession(fingerprint: ChatGptFingerprint) {
  return new CookieSession({
    "user-agent": fingerprint.userAgent,
    "accept-language": "en-US,en;q=0.9",
    origin: CHATGPT_BASE_URL,
    referer: `${CHATGPT_BASE_URL}/`,
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
  return normalized || DEFAULT_CHATGPT_IMAGE_MODEL;
}

export async function bootstrapChatGptSession(session: CookieSession, fingerprint: ChatGptFingerprint) {
  logger.info("openai-client", "bootstrap:start", {
    deviceId: fingerprint.deviceId,
    hasSessionId: Boolean(fingerprint.sessionId),
  });
  const response = await session.fetch(`${CHATGPT_BASE_URL}/`, { timeoutMs: 30000 });
  const html = await response.text();
  if (!response.ok) {
    logger.warn("openai-client", "bootstrap:non-ok", {
      status: response.status,
      bodyPreview: html.slice(0, 240),
    });
  }
  captureBuildInfoFromHtml(html);
  logger.info("openai-client", "bootstrap:done", {
    deviceId: fingerprint.deviceId,
    status: response.status,
  });
  return fingerprint.deviceId;
}

export async function getChatRequirements(
  session: CookieSession,
  accessToken: string,
  deviceId: string,
  userAgent: string,
) {
  const config = getPowConfig(userAgent);
  logger.info("openai-client", "chat-requirements:start", {
    deviceId,
    token: maskAccessToken(accessToken),
  });
  const response = await session.fetch(`${CHATGPT_BASE_URL}/backend-api/sentinel/chat-requirements`, {
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
    const bodyText = (await response.text()).slice(0, 400);
    logger.error("openai-client", "chat-requirements:failed", {
      deviceId,
      token: maskAccessToken(accessToken),
      status: response.status,
      bodyPreview: bodyText,
    });
    throw buildHttpImageError(bodyText || `chat-requirements failed: ${response.status}`, response.status, "submit");
  }

  const payload = (await response.json()) as {
    token: string;
    proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
  };

  logger.info("openai-client", "chat-requirements:done", {
    deviceId,
    token: maskAccessToken(accessToken),
    proofRequired: Boolean(payload.proofofwork?.required),
  });

  return {
    chatToken: payload.token,
    pow: payload.proofofwork || {},
    powConfig: config,
  };
}

export async function fetchRemoteAccountInfo(accessToken: string, account: AccountRecord | null) {
  const fingerprint = resolveFingerprint(account);
  const session = new CookieSession({
    accept: "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "oai-language": "zh-CN",
    origin: CHATGPT_BASE_URL,
    referer: `${CHATGPT_BASE_URL}/`,
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
    session.fetch(`${CHATGPT_BASE_URL}/backend-api/me`, {
      headers: meHeaders,
      timeoutMs: 20000,
    }),
    session.fetch(`${CHATGPT_BASE_URL}/backend-api/conversation/init`, {
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
