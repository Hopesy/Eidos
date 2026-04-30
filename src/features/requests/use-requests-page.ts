"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { fetchRequestLogs, type RequestLogItem } from "@/lib/api";

import {
  buildRequestsSummary,
  filterRequestLogs,
  sortRequestLogsByLatest,
  type RequestOperationFilter,
  type RequestResultFilter,
} from "./request-view-model";

export function useRequestsPage() {
  const [items, setItems] = useState<RequestLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resultFilter, setResultFilter] = useState<RequestResultFilter>("all");
  const [operationFilter, setOperationFilter] = useState<RequestOperationFilter>("all");

  const loadItems = async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const data = await fetchRequestLogs();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取调用请求失败");
    } finally {
      if (isRefresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const summary = useMemo(() => buildRequestsSummary(items), [items]);

  const filteredItems = useMemo(
    () => filterRequestLogs(items, { resultFilter, operationFilter }),
    [items, operationFilter, resultFilter],
  );

  const sortedItems = useMemo(
    () => sortRequestLogsByLatest(filteredItems),
    [filteredItems],
  );

  return {
    isLoading,
    isRefreshing,
    resultFilter,
    setResultFilter,
    operationFilter,
    setOperationFilter,
    summary,
    filteredItems,
    sortedItems,
    refreshItems: () => loadItems(true),
  };
}
