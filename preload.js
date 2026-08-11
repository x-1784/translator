const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onDownloadProgress: (callback) => {
    // 先清掉旧监听，避免重复下载时进度回调叠加
    ipcRenderer.removeAllListeners("download-progress");
    ipcRenderer.on("download-progress", (event, progress) => callback(progress));
  },

  // 截图相关
  screenshotComplete: (region) => ipcRenderer.invoke("screenshot-complete", region),
  screenshotCancel: () => ipcRenderer.invoke("screenshot-cancel"),
  onScreenshotCaptured: (callback) => ipcRenderer.on("screenshot-captured", (event, dataUrl) => callback(dataUrl)),
  getScreenshotShortcut: () => ipcRenderer.invoke("get-screenshot-shortcut"),
  triggerScreenshot: () => ipcRenderer.invoke("trigger-screenshot"),

  // 窗口置顶
  toggleAlwaysOnTop: () => ipcRenderer.invoke("toggle-always-on-top"),
});