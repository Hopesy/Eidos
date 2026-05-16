/**
 * 简单的按天滚动日志模块
 * 日志写入 <repo_root>/logs/YYYY-MM-DD.log
 * 格式：[北京时间] [步骤] [module] message  {...data}
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type LogLevel = "INFO" | "WARN" | "ERROR";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const messageLabels: Record<string, { step: string; text: string }> = {
    "api-service:done": { step: "图像API完成", text: "图像 API 请求完成" },
    "api-service:edit:done": { step: "编辑完成", text: "图像 API 编辑完成" },
    "api-service:edit:failed": { step: "编辑失败", text: "图像 API 编辑失败" },
    "api-service:edit:start": { step: "编辑图像API", text: "开始请求图像 API 编辑" },
    "api-service:failed": { step: "图像API失败", text: "图像 API 请求失败" },
    "api-service:start": { step: "请求图像API", text: "开始请求图像 API" },
    "bootstrap:done": { step: "初始化完成", text: "上游会话初始化完成" },
    "bootstrap:non-ok": { step: "初始化异常", text: "上游会话初始化异常" },
    "bootstrap:start": { step: "初始化会话", text: "初始化上游会话" },
    "chat-requirements:done": { step: "校验完成", text: "上游校验完成" },
    "chat-requirements:failed": { step: "校验失败", text: "上游校验失败" },
    "chat-requirements:start": { step: "获取校验", text: "获取上游校验参数" },
    "conversation:accepted": { step: "上游受理", text: "上游已受理请求" },
    "conversation:failed": { step: "提交失败", text: "提交上游失败" },
    "conversation:start": { step: "提交上游", text: "提交请求到上游" },
    "download-image:done": { step: "下载完成", text: "图片下载完成" },
    "download-image:empty": { step: "图片为空", text: "下载结果为空" },
    "download-image:failed": { step: "下载失败", text: "图片下载失败" },
    "download-url:done": { step: "获取下载地址", text: "已获取图片下载地址" },
    "download-url:error": { step: "取地址失败", text: "获取下载地址异常" },
    "download-url:failed": { step: "取地址失败", text: "获取下载地址失败" },
    "generate-image:attachments:start": { step: "上传参考图", text: "上传参考图到上游" },
    "generate-image:done": { step: "生成完成", text: "图片生成完成" },
    "generate-image:file-download-failed": { step: "下载失败", text: "生成图片下载失败" },
    "generate-image:file-download-fallback": { step: "轮询补图", text: "改用轮询补齐图片" },
    "generate-image:file-download-fallback-poll-failed": { step: "轮询失败", text: "轮询补图失败" },
    "generate-image:file-download-retry": { step: "重试下载", text: "重试下载生成图片" },
    "generate-image:file-downloaded": { step: "下载图片", text: "生成图片已下载" },
    "generate-image:input-blocked": { step: "提示词受限", text: "上游拒绝生成图片" },
    "generate-image:no-file-ids": { step: "未返回图片", text: "上游未返回图片文件" },
    "generate-image:no-file-ids-short-circuit": { step: "等待生成", text: "上游仍在生成图片" },
    "generate-image:source-invalid": { step: "源图无效", text: "上游未识别源图" },
    "generate-image:sse-parsed": { step: "解析响应", text: "解析上游生成响应" },
    "generate-image:start": { step: "开始生成", text: "开始生成图片" },
    "image-file:not-found": { step: "图片不存在", text: "图片文件不存在" },
    "image-file:serve-failed": { step: "读取失败", text: "读取图片文件失败" },
    "image-file:served": { step: "读取图片", text: "读取图片文件" },
    "image-file:stored": { step: "保存图片", text: "保存图片文件" },
    "image-response:persisted": { step: "保存结果", text: "保存图片结果" },
    "poll-image-ids:done": { step: "轮询完成", text: "已轮询到图片文件" },
    "poll-image-ids:error": { step: "轮询异常", text: "轮询图片异常" },
    "poll-image-ids:input-blocked": { step: "提示词受限", text: "网页端标题显示生成被拒绝" },
    "poll-image-ids:non-ok": { step: "轮询异常", text: "轮询图片返回异常状态" },
    "poll-image-ids:rate-limited": { step: "轮询限流", text: "轮询图片被上游限流" },
    "poll-image-ids:start": { step: "轮询图片", text: "开始轮询图片结果" },
    "poll-image-ids:timeout": { step: "轮询超时", text: "轮询图片超时" },
    "request:canceled": { step: "取消请求", text: "请求已取消" },
    "request:failed": { step: "请求失败", text: "请求处理失败" },
    "request:pending": { step: "等待结果", text: "上游仍在处理" },
    "request:start": { step: "开始请求", text: "开始处理请求" },
    "request:success": { step: "请求完成", text: "请求处理完成" },
    "responses-service:edit:start": { step: "编辑Responses", text: "开始请求 Responses 编辑" },
    "responses-service:generate:start": { step: "请求Responses", text: "开始请求 Responses 生成" },
};

function getLogsDir(): string {
    const envLogsDir = process.env.EIDOS_LOGS_DIR?.trim();
    if (envLogsDir) {
        return path.resolve(/*turbopackIgnore: true*/ envLogsDir);
    }
    return path.join(/*turbopackIgnore: true*/ process.cwd(), "logs");
}

let logsDirReady = false;

async function ensureLogsDir(): Promise<void> {
    if (logsDirReady) return;
    await mkdir(/*turbopackIgnore: true*/ getLogsDir(), { recursive: true });
    logsDirReady = true;
}

function pad(value: number, size = 2): string {
    return String(value).padStart(size, "0");
}

function toBeijingDate(date: Date): Date {
    return new Date(date.getTime() + BEIJING_OFFSET_MS);
}

export function getBeijingDateStamp(date = new Date()): string {
    const beijingDate = toBeijingDate(date);
    return [
        beijingDate.getUTCFullYear(),
        pad(beijingDate.getUTCMonth() + 1),
        pad(beijingDate.getUTCDate()),
    ].join("-");
}

export function formatBeijingTimestamp(date = new Date()): string {
    const beijingDate = toBeijingDate(date);
    return `${getBeijingDateStamp(date)} ${pad(beijingDate.getUTCHours())}:${pad(beijingDate.getUTCMinutes())}:${pad(beijingDate.getUTCSeconds())}`;
}

function isEnglishEventCode(message: string): boolean {
    return /^[a-z0-9-]+(?::[a-z0-9-]+)+$/.test(message);
}

function inferChineseStep(level: LogLevel, message: string): string {
    if (message.includes("取消")) return "取消请求";
    if (message.includes("重试") || message.includes("再次请求") || message.includes("切换下一个")) return "准备重试";
    if (message.includes("跳过")) return "跳过处理";
    if (message.includes("失败") || message.includes("错误") || message.includes("异常")) return "处理失败";
    if (message.includes("完成") || message.includes("成功") || message.includes("已启动") || message.includes("已停止")) {
        return "处理完成";
    }
    if (message.includes("开始")) return "开始处理";
    if (level === "ERROR") return "处理失败";
    if (level === "WARN") return "需要注意";
    return "处理中";
}

function formatMessage(level: LogLevel, message: string): { step: string; text: string } {
    const labeled = messageLabels[message];
    if (labeled) {
        return labeled;
    }

    const step = inferChineseStep(level, message);
    return {
        step,
        text: isEnglishEventCode(message) ? step : message,
    };
}

export function formatLogLine(
    level: LogLevel,
    module: string,
    message: string,
    data?: unknown,
    date = new Date(),
): string {
    const ts = formatBeijingTimestamp(date);
    const display = formatMessage(level, message);
    const dataSuffix = data !== undefined ? "  " + JSON.stringify(data, null, 0) : "";
    return `[${ts}] [${display.step}] [${module}] ${display.text}${dataSuffix}\n`;
}

async function writeLog(level: LogLevel, module: string, message: string, data?: unknown): Promise<void> {
    const now = new Date();
    const line = formatLogLine(level, module, message, data, now);
    // 同步打印到控制台（便于开发时查看）
    if (level === "ERROR") {
        console.error(line.trimEnd());
    } else {
        console.log(line.trimEnd());
    }
    // 异步写文件，不阻塞请求处理
    try {
        await ensureLogsDir();
        const logFile = path.join(getLogsDir(), `${getBeijingDateStamp(now)}.log`);
        await appendFile(/*turbopackIgnore: true*/ logFile, line, "utf8");
    } catch {
        // 日志写入失败不应影响业务
    }
}

export const logger = {
    info(module: string, message: string, data?: unknown): void {
        void writeLog("INFO", module, message, data);
    },
    warn(module: string, message: string, data?: unknown): void {
        void writeLog("WARN", module, message, data);
    },
    error(module: string, message: string, data?: unknown): void {
        void writeLog("ERROR", module, message, data);
    },
};
