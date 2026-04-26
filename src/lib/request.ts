import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import webConfig from "@/constants/common-env";

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
    async (error: AxiosError<{ detail?: { error?: string }; error?: string; message?: string }>) => {
        const payload = error.response?.data;
        const message =
            payload?.detail?.error ||
            payload?.error ||
            payload?.message ||
            error.message ||
            `请求失败 (${error.response?.status || 500})`;
        return Promise.reject(new Error(message));
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
