const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { startServer } = require("./app-server");

const APP_NAME = "FluxTranslate";
const APP_ICON = path.join(__dirname, "assets", "icon.ico");

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;
let hasShownTrayHint = false;

function getIconPath() {
  return APP_ICON;
}

function setupAutoUpdater() {
  const { autoUpdater } = require("electron-updater");

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 移除所有弹窗，只返回检查结果
  autoUpdater.on("error", (err) => {
    console.error("Update error:", err);
  });

  return autoUpdater;
}

async function ensureServer() {
  if (serverHandle) {
    return serverHandle;
  }

  serverHandle = await startServer(Number(process.env.PORT || 3000));
  return serverHandle;
}

function showWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideWindowToTray() {
  if (!mainWindow) {
    return;
  }

  mainWindow.hide();

  if (!hasShownTrayHint) {
    hasShownTrayHint = true;
    tray?.displayBalloon({
      iconType: "info",
      title: APP_NAME,
      content: "应用已最小化到系统托盘，可从托盘重新打开。",
    });
  }
}

function createTray() {
  if (tray) {
    return tray;
  }

  const trayImage = nativeImage.createFromPath(getIconPath());
  tray = new Tray(trayImage);
  tray.setToolTip(APP_NAME);
  tray.addListener("double-click", showWindow);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: showWindow,
    },
    {
      label: "隐藏窗口",
      click: () => {
        if (mainWindow) {
          hideWindowToTray();
        }
      },
    },
    { type: "separator" },
    {
      label: "检查更新",
      click: () => {
        autoUpdater.checkForUpdates().catch((err) => {
          dialog.showErrorBox("更新检查失败", err.message || String(err));
        });
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: async () => {
        isQuitting = true;
        await app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}

async function createWindow() {
  const activeServer = await ensureServer();
  createTray();

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#07111f",
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: getIconPath(),
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      devTools: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("minimize", (event) => {
    // 直接最小化，不拦截
  });

  mainWindow.on("close", (event) => {
    // 直接退出，不再最小化到托盘
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(activeServer.url);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

app.setAppUserModelId("com.fluxtranslate.desktop");

app.whenReady().then(async () => {
  try {
    await createWindow();

    // 设置 IPC 监听器处理检查更新请求
    ipcMain.handle("check-for-updates", async () => {
      try {
        const autoUpdater = setupAutoUpdater();
        const result = await autoUpdater.checkForUpdates();

        if (!result || !result.updateInfo) {
          return { success: true, isLatest: true, version: app.getVersion() };
        }

        const latestVersion = result.updateInfo.version;
        const currentVersion = app.getVersion();

        if (latestVersion === currentVersion) {
          return { success: true, isLatest: true, version: currentVersion };
        } else {
          return {
            success: true,
            isLatest: false,
            currentVersion,
            latestVersion,
            releaseNotes: result.updateInfo.releaseNotes
          };
        }
      } catch (error) {
        // 如果是没有发布版本的错误，返回友好提示
        if (error.message && error.message.includes("No published versions")) {
          return { success: true, isLatest: true, version: app.getVersion() };
        }
        return { success: false, message: error.message || "检查更新失败" };
      }
    });

    // 处理下载更新请求
    ipcMain.handle("download-update", async () => {
      try {
        const autoUpdater = setupAutoUpdater();
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    // 处理安装更新请求
    ipcMain.handle("install-update", () => {
      isQuitting = true;
      const autoUpdater = setupAutoUpdater();
      autoUpdater.quitAndInstall();
    });
  } catch (error) {
    console.error("Failed to launch desktop app:", error);
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
      return;
    }

    showWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", async () => {
  if (process.platform === "darwin") {
    return;
  }

  if (serverHandle) {
    try {
      await serverHandle.close();
    } catch (error) {
      console.error("Failed to stop local server:", error);
    }
    serverHandle = null;
  }

  tray?.destroy();
  tray = null;
  app.quit();
});
