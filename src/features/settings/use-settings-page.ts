"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { fetchConfig, fetchDefaultConfig, updateConfig } from "@/lib/api";
import { getDefaultConfigPayload, type ConfigPayload } from "@/shared/app-config";
import { clearCachedSyncStatus } from "@/store/sync-status-cache";

export function useSettingsPage() {
  const [config, setConfig] = useState<ConfigPayload>(getDefaultConfigPayload());
  const [savedConfig, setSavedConfig] = useState<ConfigPayload>(getDefaultConfigPayload());
  const [defaultConfig, setDefaultConfig] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );

  async function loadCurrentConfig() {
    try {
      const cfgRes = await fetchConfig();
      if (cfgRes) {
        setConfig(cfgRes);
        setSavedConfig(cfgRes);
      }
    } catch {
      toast.error("读取配置失败");
    }
  }

  async function loadDefaultConfig(options?: { suppressError?: boolean }) {
    try {
      const defRes = await fetchDefaultConfig();
      if (defRes) {
        setDefaultConfig(defRes);
        return defRes;
      }
    } catch {
      if (!options?.suppressError) {
        toast.error("读取默认配置失败");
      }
    }
    return null;
  }

  useEffect(() => {
    setLoading(true);
    void loadCurrentConfig().finally(() => setLoading(false));
  }, []);

  async function restoreDefaults() {
    setRestoringDefaults(true);
    try {
      const nextDefaults = defaultConfig ?? (await loadDefaultConfig());
      if (!nextDefaults) {
        return;
      }
      setConfig(nextDefaults);
      toast.info("已恢复默认配置（未保存）");
    } finally {
      setRestoringDefaults(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const res = await updateConfig(config);
      if (res) {
        setSavedConfig(res);
        setConfig(res);
      }
      clearCachedSyncStatus();
      toast.success("配置已保存");
    } catch {
      toast.error("保存配置失败");
    } finally {
      setSaving(false);
    }
  }

  function setSection<K extends keyof ConfigPayload>(
    section: K,
    patch: Partial<NonNullable<ConfigPayload[K]>>,
  ) {
    setConfig((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as object), ...patch },
    }));
  }

  return {
    config,
    loading,
    saving,
    restoringDefaults,
    isDirty,
    restoreDefaults,
    saveConfig,
    setSection,
  };
}
