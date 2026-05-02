"use server";

import { revalidatePath } from "next/cache";

import { setSavedConfig } from "@/server/repositories/config";
import { sanitizeConfigPayload, type ConfigPayload } from "@/shared/app-config";

export async function saveSettingsConfigAction(config: ConfigPayload) {
    const sanitized = sanitizeConfigPayload(config);

    setSavedConfig(sanitized);
    revalidatePath("/settings");
    revalidatePath("/accounts");

    return sanitized;
}
