export const BASE_URL = "https://chatgpt.com";

export type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

export type ChatGptResultSession = {
  fetch(url: string, options?: FetchOptions): Promise<Response>;
};

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
