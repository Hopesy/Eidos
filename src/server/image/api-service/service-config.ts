import type { ImageApiStyle } from "@/lib/api";
import { getSavedConfig } from "@/server/repositories/config";
import { getDefaultConfigPayload } from "@/shared/app-config";

function cleanToken(value: unknown) {
  return String(value || "").trim();
}

export function getImageApiServiceConfig() {
  const defaultChatgptConfig = getDefaultConfigPayload().chatgpt;
  const savedConfig = getSavedConfig() as
    | {
      chatgpt?: {
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        apiStyle?: ImageApiStyle;
        responsesModel?: string;
      };
    }
    | null;
  const enabled = Boolean(savedConfig?.chatgpt?.enabled);
  const baseUrl = cleanToken(savedConfig?.chatgpt?.baseUrl) || cleanToken(defaultChatgptConfig?.baseUrl) || "https://api.openai.com/v1";
  const apiKey = cleanToken(savedConfig?.chatgpt?.apiKey);
  const apiStyle = (cleanToken(savedConfig?.chatgpt?.apiStyle) || cleanToken(defaultChatgptConfig?.apiStyle) || "v1") as ImageApiStyle;
  const responsesModel =
    cleanToken(savedConfig?.chatgpt?.responsesModel) || cleanToken(defaultChatgptConfig?.responsesModel) || "gpt-5.5";
  if (!enabled) {
    return null;
  }
  return {
    baseUrl,
    apiKey,
    apiStyle,
    responsesModel,
  };
}

export type ImageApiServiceConfig = NonNullable<ReturnType<typeof getImageApiServiceConfig>>;
export type ImageApiTaskResult = { created: number; data: Array<Record<string, unknown>> };
