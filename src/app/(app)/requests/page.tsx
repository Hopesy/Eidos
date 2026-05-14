import { RequestsClient } from "./requests-client";

import { REQUEST_LOG_PAGE_LIMIT } from "@/features/requests/request-limits";
import { getRequestLogs } from "@/server/repositories/request-log";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
    const initialItems = getRequestLogs(REQUEST_LOG_PAGE_LIMIT);

    return <RequestsClient initialItems={initialItems} />;
}
