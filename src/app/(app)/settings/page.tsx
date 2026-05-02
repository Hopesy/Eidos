import { saveSettingsConfigAction } from "./actions";
import { SettingsClient } from "./settings-client";

import { getSavedConfig } from "@/server/repositories/config";
import { getDefaultConfigPayload, sanitizeConfigPayload } from "@/shared/app-config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
    const defaultConfig = getDefaultConfigPayload();
    const savedConfig = getSavedConfig();
    const initialConfig = savedConfig ? sanitizeConfigPayload(savedConfig) : defaultConfig;

    return (
        <SettingsClient
            initialConfig={initialConfig}
            initialDefaultConfig={defaultConfig}
            saveConfigAction={saveSettingsConfigAction}
        />
    );
}
