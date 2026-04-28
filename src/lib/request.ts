import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import webConfig from "@/constants/common-env";

export class ApiRequestError extends Error {
    status?: number;
    failureKind?: string;
    retryAction?: string;
    retryable?: boolean;
    stage?: string;
    upstreamConversationId?: string;
    upstreamResponseId?: string;
    imageGenerationCallId?: string;
    sourceAccountId?: string;
    fileIds?: string[];

    constructor(message: string, options: {
        status?: number;
        failureKind?: string;
        retryAction?: string;
        retryable?: boolean;
        stage?: string;
        upstreamConversationId?: string;
        upstreamResponseId?: string;
        imageGenerationCallId?: string;
        sourceAccountId?: string;
        fileIds?: string[];
    } = {}) {
        super(message);
        this.name = "ApiRequestError";
        this.status = options.status;
        this.failureKind = options.failureKind;
        this.retryAction = options.retryAction;
        this.retryable = options.retryable;
        this.stage = options.stage;
        this.upstreamConversationId = options.upstreamConversationId;
        this.upstreamResponseId = options.upstreamResponseId;
        this.imageGenerationCallId = options.imageGenerationCallId;
        this.sourceAccountId = options.sourceAccountId;
        this.fileIds = options.fileIds;
    }
}

const request = axios.create({
    baseURL: webConfig.apiUrl.replace(/\/$/, ""),
});

request.interceptors.request.use(async (config) => {
    const nextConfig = { ...config };
    const headers = { ...(nextConfig.headers || {}) } as Record<string, string>;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    nextConfig.headers = headers;
    return nextConfig;
});

request.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<{
        detail?: {
            error?: string;
            failureKind?: string;
            retryAction?: string;
            retryable?: boolean;
            stage?: string;
            upstreamConversationId?: string;
            upstreamResponseId?: string;
            imageGenerationCallId?: string;
            sourceAccountId?: string;
            fileIds?: string[];
        };
        error?: string;
        message?: string;
    }>) => {
        const payload = error.response?.data;
        const message =
            payload?.detail?.error ||
            payload?.error ||
            payload?.message ||
            error.message ||
            `请求失败 (${error.response?.status || 500})`;
        return Promise.reject(new ApiRequestError(message, {
            status: error.response?.status,
            failureKind: payload?.detail?.failureKind,
            retryAction: payload?.detail?.retryAction,
            retryable: payload?.detail?.retryable,
            stage: payload?.detail?.stage,
            upstreamConversationId: payload?.detail?.upstreamConversationId,
            upstreamResponseId: payload?.detail?.upstreamResponseId,
            imageGenerationCallId: payload?.detail?.imageGenerationCallId,
            sourceAccountId: payload?.detail?.sourceAccountId,
            fileIds: payload?.detail?.fileIds,
        }));
    },
);

type RequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
};

export async function httpRequest<T>(path: string, options: RequestOptions = {}) {
    const { method = "GET", body, headers, signal } = options;
    const config: AxiosRequestConfig = {
        url: path,
        method,
        data: body,
        headers,
        signal,
    };
    const response = await request.request<T>(config);
    return response.data;
}
