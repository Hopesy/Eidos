import { RequestsClient } from "./requests-client";

import { getRequestLogs } from "@/server/repositories/request-log";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
    const initialItems = getRequestLogs();

    return <RequestsClient initialItems={initialItems} />;
}
