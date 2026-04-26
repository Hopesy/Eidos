const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { createWriteStream } = require("node:fs");
const { mkdir, stat } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let serverPort = 0;
let isQuitting = false;
let updateCheckPromise = null;
let installerDownloadPromise = null;

const RELEASES_PAGE_URL = "https://github.com/Hopesy/Eidos/releases";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/Hopesy/Eidos/releases/latest";
const INSTALLER_ASSET_PATTERN = /^Eidos-Setup-.*\.exe$/i;

/** @type {{
 * supported: boolean;
 * status: "idle" | "checking" | "up-to-date" | "update-available" | "downloading" | "installer-ready" | "error";
 * currentVersion: string;
 * latestVersion: string | null;
 * releaseName: string | null;
 * releaseNotes: string | null;
 * publishedAt: string | null;
 * assetName: string | null;
 * downloadUrl: string | null;
 * releasePageUrl: string;
 * checkedAt: string | null;
 * message: string;
 * error: string | null;
 * progressPercent: number | null;
 * downloadedBytes: number;
 * totalBytes: number;
 * downloadedFilePath: string | null;
 * }}
 */
let updaterState = {
  supported: true,
  status: "idle",
  currentVersion: normalizeVersion(app.getVersion()) || "0.0.0",
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  publishedAt: null,
  assetName: null,
  downloadUrl: null,
  releasePageUrl: RELEASES_PAGE_URL,
  checkedAt: null,
  message: "尚未检查更新",
  error: null,
  progressPercent: null,
  downloadedBytes: 0,
  totalBytes: 0,
  downloadedFilePath: null,
};

function getStandaloneDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-bundle", "standalone")
    : path.join(__dirname, "app", "standalone");
}

function getServerEntry() {
  return path.join(getStandaloneDir(), "server.js");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f7f6f3",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v+/i, "");
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  const [mainPart, preRelease = ""] = normalized.split("-", 2);
  const parts = mainPart
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  return { parts, preRelease };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.parts[index] ?? 0;
    const rightPart = b.parts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  if (a.preRelease && !b.preRelease) {
    return -1;
  }
  if (!a.preRelease && b.preRelease) {
    return 1;
  }
  return 0;
}

function cloneUpdaterState() {
  return { ...updaterState };
}

function broadcastUpdaterState() {
  const payload = cloneUpdaterState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("eidos-updater:state-changed", payload);
  }
}

function setUpdaterState(patch) {
  updaterState = {
    ...updaterState,
    ...patch,
  };
  broadcastUpdaterState();
  return cloneUpdaterState();
}

function selectInstallerAsset(assets) {
  if (!Array.isArray(assets)) {
    return null;
  }

  return (
    assets.find((asset) => INSTALLER_ASSET_PATTERN.test(String(asset?.name || ""))) ??
    assets.find((asset) => /\.exe$/i.test(String(asset?.name || ""))) ??
    null
  );
}

async function fetchLatestRelease() {
  const response = await fetch(LATEST_RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Eidos-Desktop-Updater",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Release 检查失败 (${response.status})`);
  }

  /** @type {{
   * tag_name?: string;
   * name?: string;
   * body?: string;
   * html_url?: string;
   * published_at?: string;
   * assets?: Array<{ name?: string; browser_download_url?: string }>;
   * }}
   */
  const payload = await response.json();
  const installerAsset = selectInstallerAsset(payload.assets);
  const version = normalizeVersion(payload.tag_name || payload.name || "");

  if (!version) {
    throw new Error("最新 Release 缺少可识别的版本号");
  }

  return {
    version,
    releaseName: payload.name || payload.tag_name || version,
    releaseNotes: typeof payload.body === "string" ? payload.body.trim() : "",
    publishedAt: payload.published_at || null,
    assetName: installerAsset?.name || null,
    downloadUrl: installerAsset?.browser_download_url || null,
    releasePageUrl: payload.html_url || RELEASES_PAGE_URL,
  };
}

async function checkForUpdates() {
  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  setUpdaterState({
    status: "checking",
    checkedAt: null,
    message: "正在检查 GitHub Release 更新…",
    error: null,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: 0,
  });

  updateCheckPromise = (async () => {
    try {
      const release = await fetchLatestRelease();
      const checkedAt = new Date().toISOString();
      const commonPatch = {
        latestVersion: release.version,
        releaseName: release.releaseName,
        releaseNotes: release.releaseNotes || null,
        publishedAt: release.publishedAt,
        assetName: release.assetName,
        downloadUrl: release.downloadUrl,
        releasePageUrl: release.releasePageUrl,
        checkedAt,
        error: null,
      };

      if (compareVersions(release.version, updaterState.currentVersion) > 0) {
        if (!release.downloadUrl) {
          return setUpdaterState({
            ...commonPatch,
            status: "error",
            message: `发现新版本 v${release.version}，但 Release 中没有可用的 Windows 安装包`,
            error: "missing_installer_asset",
          });
        }

        return setUpdaterState({
          ...commonPatch,
          status: "update-available",
          message: `发现新版本 v${release.version}，可下载安装包更新`,
        });
      }

      return setUpdaterState({
        ...commonPatch,
        status: "up-to-date",
        message: `当前已是最新版本 v${updaterState.currentVersion}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return setUpdaterState({
        status: "error",
        checkedAt: new Date().toISOString(),
        message,
        error: message,
      });
    } finally {
      updateCheckPromise = null;
    }
  })();

  return updateCheckPromise;
}

async function canReuseDownloadedInstaller(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function downloadAndInstallUpdate() {
  if (installerDownloadPromise) {
    return installerDownloadPromise;
  }

  installerDownloadPromise = (async () => {
    try {
      let currentState = cloneUpdaterState();
      if (
        !currentState.latestVersion ||
        compareVersions(currentState.latestVersion, currentState.currentVersion) <= 0
      ) {
        currentState = await checkForUpdates();
      }

      if (!currentState.downloadUrl || !currentState.latestVersion) {
        throw new Error("当前没有可下载安装的更新");
      }

      if (await canReuseDownloadedInstaller(currentState.downloadedFilePath)) {
        const openResult = await shell.openPath(currentState.downloadedFilePath);
        if (openResult) {
          throw new Error(openResult);
        }

        return setUpdaterState({
          status: "installer-ready",
          message: "已重新打开已下载的安装包",
          error: null,
        });
      }

      const downloadUrl = currentState.downloadUrl;
      const assetName = currentState.assetName || `Eidos-Setup-${currentState.latestVersion}.exe`;
      const updateDir = path.join(app.getPath("temp"), "eidos-updates", currentState.latestVersion);
      const installerPath = path.join(updateDir, assetName);

      await mkdir(updateDir, { recursive: true });

      setUpdaterState({
        status: "downloading",
        message: `正在下载 ${assetName}…`,
        error: null,
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        downloadedFilePath: installerPath,
      });

      const response = await fetch(downloadUrl, {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "Eidos-Desktop-Updater",
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`安装包下载失败 (${response.status})`);
      }

      const totalBytes = Number.parseInt(response.headers.get("content-length") || "0", 10);
      let downloadedBytes = 0;
      const readable = Readable.fromWeb(response.body);

      readable.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        const progressPercent =
          totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
        setUpdaterState({
          status: "downloading",
          progressPercent,
          downloadedBytes,
          totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
          message:
            progressPercent === null
              ? `正在下载 ${assetName}…`
              : `正在下载 ${assetName}… ${progressPercent}%`,
        });
      });

      await pipeline(readable, createWriteStream(installerPath));

      const openResult = await shell.openPath(installerPath);
      if (openResult) {
        throw new Error(openResult);
      }

      return setUpdaterState({
        status: "installer-ready",
        progressPercent: 100,
        downloadedBytes,
        totalBytes: Number.isFinite(totalBytes) ? totalBytes : downloadedBytes,
        downloadedFilePath: installerPath,
        message: "安装包已下载并启动，请按安装向导完成更新",
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return setUpdaterState({
        status: "error",
        message,
        error: message,
        progressPercent: null,
      });
    } finally {
      installerDownloadPromise = null;
    }
  })();

  return installerDownloadPromise;
}

ipcMain.handle("eidos-updater:get-state", async () => cloneUpdaterState());
ipcMain.handle("eidos-updater:check", async () => checkForUpdates());
ipcMain.handle("eidos-updater:download", async () => downloadAndInstallUpdate());

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("桌面内置服务启动超时"));
        return;
      }

      const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 300);
      });
    };

    tryConnect();
  });
}

async function startServer() {
  if (serverProcess) {
    return;
  }

  serverPort = await findFreePort();
  const standaloneDir = getStandaloneDir();
  const serverEntry = getServerEntry();
  const userDataDir = app.getPath("userData");

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(serverPort),
      EIDOS_DATA_DIR: path.join(userDataDir, "data"),
      EIDOS_LOGS_DIR: path.join(userDataDir, "logs"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[eidos-server] ${chunk}`);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[eidos-server] ${chunk}`);
  });

  serverProcess.once("exit", (code) => {
    if (!isQuitting) {
      void dialog.showErrorBox(
        "Eidos 服务已退出",
        `内置服务意外退出，退出码：${code ?? "unknown"}。`,
      );
      app.quit();
    }
    serverProcess = null;
  });

  await waitForServer(serverPort);
}

app.on("before-quit", () => {
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.whenReady().then(async () => {
  try {
    const win = createWindow();
    await startServer();
    await win.loadURL(`http://127.0.0.1:${serverPort}/image`);
    void checkForUpdates();
  } catch (error) {
    dialog.showErrorBox(
      "Eidos 启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createWindow();
    if (serverPort > 0) {
      await win.loadURL(`http://127.0.0.1:${serverPort}/image`);
    }
  }
});
