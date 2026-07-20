const { app, BrowserWindow, Menu, Tray, nativeImage, dialog } = require("electron");
const path = require("node:path");
const { startServer } = require("./app-server");
const { autoUpdater } = require("electron-updater");

const APP_NAME = "FluxTranslate";
const APP_ICON = path.join(__dirname, "assets", "icon.ico");

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;
let hasShownTrayHint = false;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", (info) => {
  dialog
    .showMessageBox({
      type: "info",
      title: "发现新版本",
      message: `FluxTranslate ${info.version} 已发布，是否立即下载？`,
      buttons: ["下载更新", "稍后再说"],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
});

autoUpdater.on("update-downloaded", () => {
  dialog
    .showMessageBox({
      type: "info",
      title: "更新已就绪",
      message: "新版本已下载完成，重启应用后生效。是否立即重启？",
      buttons: ["立即重启", "稍后重启"],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on("error", (err) => {
  dialog.showErrorBox("更新检查失败", err.message || String(err));
});

function getIconPath() {
  return APP_ICON;
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
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("minimize", (event) => {
    event.preventDefault();
    hideWindowToTray();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideWindowToTray();
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
  } catch (error) {
    console.error("Failed to launch desktop app:", error);
    app.quit();
  }

  // 启动后延迟 3 秒静默检查更新，避免影响启动速度
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);

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
