import type { RequestLogItem } from "@/lib/api";

export type RequestResultFilter = "all" | "success" | "failed";
export type RequestOperationFilter = "all" | "generate" | "edit" | "upscale";
export type RequestFinalStatus = "success" | "partial" | "failed";

export const requestResultFilterOptions: { label: string; value: RequestResultFilter }[] = [
  { label: "全部", value: "all" },
  { label: "成功", value: "success" },
  { label: "失败", value: "failed" },
];

export const requestOperationFilterOptions: { label: string; value: RequestOperationFilter }[] = [
  { label: "全部操作", value: "all" },
  { label: "generate", value: "generate" },
  { label: "edit", value: "edit" },
  { label: "upscale", value: "upscale" },
];

export function formatRequestTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function resolveRequestFinalStatus(item: RequestLogItem): RequestFinalStatus {
  if (item.finalStatus === "success" || item.finalStatus === "partial" || item.finalStatus === "failed") {
    return item.finalStatus;
  }
  return item.success ? "success" : "failed";
}

export function getRequestFinalStatusMeta(status: RequestFinalStatus) {
  if (status === "success") {
    return { label: "成功", variant: "success" as const };
  }
  if (status === "partial") {
    return { label: "部分完成", variant: "warning" as const };
  }
  return { label: "失败", variant: "danger" as const };
}

export function buildRequestsSummary(items: RequestLogItem[]) {
  const success = items.filter((item) => item.success).length;
  const failed = items.filter((item) => !item.success).length;
  const latest = items[0]?.finishedAt || items[0]?.startedAt || "";
  return { total: items.length, success, failed, latest };
}

export function filterRequestLogs(
  items: RequestLogItem[],
  filters: {
    resultFilter: RequestResultFilter;
    operationFilter: RequestOperationFilter;
  },
) {
  return items.filter((item) => {
    const matchesResult =
      filters.resultFilter === "all" ||
      (filters.resultFilter === "success" ? item.success : !item.success);
    const normalizedOperation = String(item.operation || "").trim().toLowerCase();
    const matchesOperation =
      filters.operationFilter === "all" || normalizedOperation === filters.operationFilter;
    return matchesResult && matchesOperation;
  });
}

export function sortRequestLogsByLatest(items: RequestLogItem[]) {
  return [...items].sort((a, b) => {
    return (b.finishedAt || b.startedAt || "").localeCompare(a.finishedAt || a.startedAt || "");
  });
}
