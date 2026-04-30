import { getImageApiServiceConfig } from "@/server/image-api-service-config";

export type ImageApiServiceConfig = NonNullable<ReturnType<typeof getImageApiServiceConfig>>;
export type ImageApiTaskResult = { created: number; data: Array<Record<string, unknown>> };
