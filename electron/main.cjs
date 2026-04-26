const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let serverPort = 0;
let isQuitting = false;

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
