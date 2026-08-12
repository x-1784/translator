const electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// 延迟解构，确保在 Electron 环境中才访问
let app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain;
let globalShortcut, desktopCapturer, screen;

// 立即检查是否在 Electron 环境中
if (typeof electron === 'string') {
  console.error('错误：electron-main.js 必须通过 Electron 运行，而非 Node.js');
  console.error('请使用: npm start 或 electron .');
  process.exit(1);
}

// 安全解构
({ app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain } = electron);
({ globalShortcut, desktopCapturer, screen } = electron);

const { startServer } = require("./app-server");

const APP_NAME = "小简翻译";
const APP_ICON = path.join(__dirname, "assets", "icon.ico");

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;
let hasShownTrayHint = false;

function getIconPath() {
  return APP_ICON;
}

let autoUpdaterInstance = null;

function setupAutoUpdater() {
  if (autoUpdaterInstance) {
    return autoUpdaterInstance;
  }

  const { autoUpdater } = require("electron-updater");

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 移除所有弹窗，只返回检查结果
  autoUpdater.on("error", (err) => {
    console.error("Update error:", err);
  });

  // 进度监听只注册一次，避免多次下载时重复推送
  autoUpdater.on("download-progress", (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send("download-progress", {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond,
      });
    }
  });

  autoUpdaterInstance = autoUpdater;
  return autoUpdaterInstance;
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
        setupAutoUpdater()
          .checkForUpdates()
          .catch((err) => {
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

// ==================== 截图翻译功能 ====================
let screenshotWindow = null;
let lastScreenshotImage = null;

async function captureScreenshot() {
  try {
    // 隐藏主窗口
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }

    // 等待窗口隐藏
    await new Promise(resolve => setTimeout(resolve, 300));

    // 获取屏幕源
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: screen.getPrimaryDisplay().workAreaSize
    });

    if (sources.length === 0) {
      throw new Error('无法获取屏幕截图');
    }

    // 创建截图选择窗口
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    screenshotWindow = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreen: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "preload.js"),
      },
    });

    // 缓存原始截图，供裁剪时复用（避免二次截屏把主窗口拍进去）
    lastScreenshotImage = sources[0].thumbnail;
    const screenshot = lastScreenshotImage.toDataURL();
    
    await screenshotWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            cursor: crosshair; 
            overflow: hidden;
            position: relative;
          }
          #screenshot {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            user-select: none;
          }
          #selection {
            position: absolute;
            border: 2px solid #6366f1;
            background: rgba(99, 102, 241, 0.1);
            display: none;
          }
          #hint {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 14px;
            z-index: 1000;
          }
        </style>
      </head>
      <body>
        <div id="hint">按住鼠标拖动选择区域，ESC 取消</div>
        <img id="screenshot" src="${screenshot}" />
        <div id="selection"></div>
        <script>
          const img = document.getElementById('screenshot');
          const selection = document.getElementById('selection');
          const hint = document.getElementById('hint');
          let startX, startY, isSelecting = false;

          setTimeout(() => hint.style.display = 'none', 3000);

          document.addEventListener('mousedown', (e) => {
            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
            selection.style.left = startX + 'px';
            selection.style.top = startY + 'px';
            selection.style.width = '0px';
            selection.style.height = '0px';
            selection.style.display = 'block';
          });

          document.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;
            const width = e.clientX - startX;
            const height = e.clientY - startY;
            selection.style.width = Math.abs(width) + 'px';
            selection.style.height = Math.abs(height) + 'px';
            selection.style.left = (width < 0 ? e.clientX : startX) + 'px';
            selection.style.top = (height < 0 ? e.clientY : startY) + 'px';
          });

          document.addEventListener('mouseup', (e) => {
            if (!isSelecting) return;
            isSelecting = false;
            
            const endX = e.clientX;
            const endY = e.clientY;
            const x = Math.min(startX, endX);
            const y = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);

            if (width > 10 && height > 10) {
              window.electronAPI.screenshotComplete({ x, y, width, height });
            }
          });

          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              window.electronAPI.screenshotCancel();
            }
          });
        </script>
      </body>
      </html>
    `)}`);

  } catch (error) {
    console.error('Screenshot error:', error);
    if (mainWindow) {
      mainWindow.show();
    }
    dialog.showErrorBox('截图失败', error.message);
  }
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

app.setAppUserModelId("com.xiaojian.translator");

const SHORTCUT_CANDIDATES = [
  "CommandOrControl+Shift+A",
  "CommandOrControl+Alt+A",
  "CommandOrControl+Shift+T",
  "CommandOrControl+Alt+T",
];

let activeShortcut = null;

function registerScreenshotShortcut() {
  for (const accelerator of SHORTCUT_CANDIDATES) {
    if (globalShortcut.isRegistered(accelerator)) {
      continue;
    }

    const ok = globalShortcut.register(accelerator, () => {
      captureScreenshot();
    });

    if (ok) {
      activeShortcut = accelerator;
      console.log("Global shortcut registered:", accelerator);
      return accelerator;
    }
  }

  activeShortcut = null;
  console.warn("All screenshot shortcut candidates are taken; use the in-app button instead.");
  return null;
}

function registerIpcHandlers() {
  // 设置 IPC 监听器处理检查更新请求
  // 获取应用版本
  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const autoUpdater = setupAutoUpdater();
      const result = await autoUpdater.checkForUpdates();

      console.log("Update check result:", result);

      if (!result || !result.updateInfo) {
        console.log("No update info returned");
        return { success: true, isLatest: true, version: app.getVersion() };
      }

      const latestVersion = result.updateInfo.version;
      const currentVersion = app.getVersion();

      console.log(`Current: ${currentVersion}, Latest: ${latestVersion}`);

      // 版本比较：使用字符串比较可能不准确，但对于简单的版本号足够
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
      console.error("Update check error:", error);
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

      // 进度监听已在 setupAutoUpdater 中统一注册
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

  // 处理截图完成
  ipcMain.handle("screenshot-complete", async (event, region) => {
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }

    try {
      if (!lastScreenshotImage) {
        throw new Error("没有可用的截图数据");
      }

      // 从缓存的原始截图裁剪，避免再次截屏拍到主窗口
      const size = lastScreenshotImage.getSize();
      const cropRegion = {
        x: Math.max(0, Math.round(region.x)),
        y: Math.max(0, Math.round(region.y)),
        width: Math.round(region.width),
        height: Math.round(region.height),
      };
      cropRegion.width = Math.min(cropRegion.width, size.width - cropRegion.x);
      cropRegion.height = Math.min(cropRegion.height, size.height - cropRegion.y);

      if (cropRegion.width < 1 || cropRegion.height < 1) {
        throw new Error("选区太小");
      }

      const dataUrl = lastScreenshotImage.crop(cropRegion).toDataURL();
      lastScreenshotImage = null;

      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("screenshot-captured", dataUrl);
      }

      return { success: true };
    } catch (error) {
      console.error("Crop error:", error);
      lastScreenshotImage = null;
      if (mainWindow) {
        mainWindow.show();
      }
      return { success: false, message: error.message };
    }
  });

  // 处理截图取消
  ipcMain.handle("screenshot-cancel", () => {
    lastScreenshotImage = null;
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }
    if (mainWindow) {
      mainWindow.show();
    }
  });
  ipcMain.handle("toggle-always-on-top", () => {
    if (!mainWindow) return false;
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current, "floating");
    return !current;
  });

  ipcMain.handle("get-screenshot-shortcut", () => activeShortcut);

  ipcMain.handle("trigger-screenshot", () => {
    captureScreenshot();
    return { success: true };
  });

  // AI 精准识别：保存/查询智谱 API Key（写入 userData，避免打进 asar）
  ipcMain.handle("save-zhipu-key", async (event, key) => {
    const file = path.join(app.getPath("userData"), "zhipu-key.txt");
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, String(key || "").trim(), "utf8");
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle("get-zhipu-key-status", async () => {
    const file = path.join(app.getPath("userData"), "zhipu-key.txt");
    try {
      const content = await fs.promises.readFile(file, "utf8").catch(() => "");
      return { configured: !!String(content || "").trim() };
    } catch {
      return { configured: false };
    }
  });
}

app.whenReady().then(async () => {
  // 缓存写入 userData，避免打包后 asar 只读导致失败
  if (!process.env.TRANSLATION_CACHE_DIR) {
    process.env.TRANSLATION_CACHE_DIR = path.join(app.getPath("userData"), "translation-cache");
  }

  // AI OCR 的智谱 Key 文件指向 userData（打包后 asar 只读，Key 不能写在应用目录）
  if (!process.env.ZHIPU_KEY_FILE) {
    process.env.ZHIPU_KEY_FILE = path.join(app.getPath("userData"), "zhipu-key.txt");
  }

  try {
    registerIpcHandlers();
    await createWindow();

    registerScreenshotShortcut();

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

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
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
