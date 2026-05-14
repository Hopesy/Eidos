import { httpRequest } from "@/lib/request";

import type { RequestLogItem } from "../types";

type FetchRequestLogsOptions = {
  limit?: number;
};

export async function fetchRequestLogs(options: FetchRequestLogsOptions = {}) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  return httpRequest<{ items: RequestLogItem[] }>(`/api/requests${query ? `?${query}` : ""}`);
}
