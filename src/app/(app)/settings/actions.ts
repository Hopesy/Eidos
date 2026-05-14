"use server";

import { revalidatePath } from "next/cache";

import { ensureAccountWatcherStarted } from "@/server/account-service";
import { setSavedConfig } from "@/server/repositories/config";
import { sanitizeConfigPayload, type ConfigPayload } from "@/shared/app-config";

export async function saveSettingsConfigAction(config: ConfigPayload) {
    const sanitized = sanitizeConfigPayload(config);

    setSavedConfig(sanitized);
    await ensureAccountWatcherStarted({ reload: true });
    revalidatePath("/settings");
    revalidatePath("/image");
    revalidatePath("/accounts");

    return sanitized;
}
