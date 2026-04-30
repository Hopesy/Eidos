import { httpRequest } from "@/lib/request";

import type { RequestLogItem } from "../types";

export async function fetchRequestLogs() {
  return httpRequest<{ items: RequestLogItem[] }>("/api/requests");
}
