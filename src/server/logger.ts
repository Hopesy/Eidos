/**
 * 简单的按天滚动日志模块
 * 日志写入 <repo_root>/logs/YYYY-MM-DD.log
 * 格式：[ISO时间] [LEVEL] [module] message  {...data}
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const logsDir = path.resolve(
    process.env.EIDOS_LOGS_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "logs"),
);

let logsDirReady = false;

async function ensureLogsDir(): Promise<void> {
    if (logsDirReady) return;
    await mkdir(logsDir, { recursive: true });
    logsDirReady = true;
}

function todayStr(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatLine(level: string, module: string, message: string, data?: unknown): string {
    const ts = new Date().toISOString();
    const levelPad = level.padEnd(5);
    const dataSuffix = data !== undefined ? "  " + JSON.stringify(data, null, 0) : "";
    return `[${ts}] [${levelPad}] [${module}] ${message}${dataSuffix}\n`;
}

async function writeLog(level: string, module: string, message: string, data?: unknown): Promise<void> {
    const line = formatLine(level, module, message, data);
    // 同步打印到控制台（便于开发时查看）
    if (level === "ERROR") {
        console.error(line.trimEnd());
    } else {
        console.log(line.trimEnd());
    }
    // 异步写文件，不阻塞请求处理
    try {
        await ensureLogsDir();
        const logFile = path.join(logsDir, `${todayStr()}.log`);
        await appendFile(logFile, line, "utf8");
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
