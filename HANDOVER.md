# 小简翻译 · 项目交接文档

> 面向接手本项目的开发者。目标：看完这份文档后，你能独立完成环境搭建、本地运行、功能开发、打包与版本发布。

---

## 1. 项目简介

**小简翻译（XiaoJian-Translator）** 是一款基于 Electron 的桌面翻译应用，简洁优雅，支持：

- 多语言互译（中 / 英 / 日 / 韩 / 法 / 德 / 西 / 俄 / 阿 / 泰 / 越 / 葡 / 意）
- 图片 OCR 文字识别翻译
- 文档翻译（TXT / PDF）
- 本地历史记录（搜索 / 筛选 / 收藏 / 标签）
- 翻译统计
- 自动更新（electron-updater）

**当前版本**：v1.0.8（2026-08-04）

**技术栈**：
| 技术 | 用途 |
|------|------|
| Electron ^43 | 桌面应用框架 |
| Node.js 内置 `http` 模块 | 本地后端服务（无 Express 等框架） |
| MyMemory API | 翻译引擎（免费） |
| tesseract.js | 图片 OCR |
| electron-updater | 自动更新 |
| electron-builder | 打包 |

---

## 2. 快速上手（环境搭建与启动）

### 前置要求
- Node.js **18+**（代码使用内置 `fetch`，需要新版本）

### 安装依赖
```bash
npm install
```

### ⚠️ 关键环境坑：本地 electron 版本不匹配（必读）

**现象**：`npm start` 启动桌面版时报错：

```
TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')
```

**原因**：`node_modules` 里实际安装的 electron 二进制是 **v24.18.0**，而 package.json 声明的是 `^43.1.1`，版本不匹配导致 `app` 对象加载失败。

> 用 `node_modules/.bin/electron --version` 可验证当前实际版本。

**修复方法**（二选一）：
```bash
# 方案 A：指定版本重装
npm install electron@^43

# 方案 B：删除后重新安装
rm -rf node_modules/electron
npm install
```

**注意**：打包（`npm run build:win`）**不受此问题影响**——electron-builder 会通过 npmmirror 镜像独立下载正确的 43.1.1 版本。

### 启动
```bash
# 桌面版（Electron 窗口）
npm start
# 等价命令
npm run desktop

# Web 版（浏览器访问）
npm run start:web
# → http://127.0.0.1:3000
```

---

## 3. 项目结构总览

```
translator/
├─ electron-main.js        # Electron 主进程：窗口/托盘/单实例/自动更新 IPC  ★在用
├─ app-server.js           # 本地 HTTP 服务 + MyMemory 翻译后端              ★在用
├─ server-fixed.js         # Web 版启动入口（app-server 的薄封装）           ★在用
├─ preload.js              # 预加载脚本，暴露 window.electronAPI             ★在用
├─ package.json            # 脚本 / 依赖 / electron-builder 配置            ★在用
├─ public/
│  ├─ index.html           # 主界面（6 页）                                 ★在用
│  ├─ app.js               # 前端逻辑（完整版）                             ★在用
│  ├─ styles.css           # 全局样式                                       ★在用
│  ├─ index-fixed.html     # 旧版 UI（FluxTranslate）                       ⚠遗留
│  └─ app-fixed.js         # 早期简化版前端                                 ⚠遗留
├─ server.js               # 废弃独立服务器（旧 Google API 版）             ⚠遗留
├─ assets/
│  ├─ icon.ico             # 应用图标
│  └─ icon.png             # PNG 源图
├─ dist/                   # 打包产物目录
└─ .github/workflows/      # 空目录（CI 自动发布已移除）                    ⚠遗留
```

### 核心运行链路

```
桌面版：electron-main.js
          └─ require("./app-server") → startServer() 起本地服务(默认 3000)
          └─ BrowserWindow.loadURL(http://127.0.0.1:PORT)
                    └─ "/" 路由 → public/index.html
                          └─ 引用 public/app.js + public/styles.css
                          └─ 翻译请求 POST /api/translate → MyMemory API

Web 版：node server-fixed.js → 复用同一个 app-server.js 服务
```

---

## 4. 核心功能与代码位置

### 4.1 翻译引擎 — [app-server.js](translator/app-server.js)
- `translateViaMyMemory()`：调用 `api.mymemory.translated.net/get`，返回译文、检测语言、provider
- `guessSourceLanguage()`：按字符集启发式检测源语言（中文/日/韩/阿/俄/泰，默认英文）
- `requestJson()`：统一请求封装，带 `TRANSLATION_TIMEOUT_MS` 超时（默认 8s）
- API 路由：`GET /health`、`POST /api/translate`
- ⚠️ MyMemory 为**免费 API**，有每日 / 频率限制，大量使用时需更换引擎或加缓存

### 4.2 前端界面 — [public/index.html](translator/public/index.html) / [public/app.js](translator/public/app.js) / [public/styles.css](translator/public/styles.css)
- 6 个页面：首页（翻译工作台）、历史记录、文档翻译、设置、统计、关于
- `app.js` 核心逻辑：语言选择器填充、翻译请求、历史记录管理（localStorage）、OCR、术语库、统计、更新 UI
- 数据存储：`localStorage`（key 见 `app.js` 顶部：`translator-history-v3`、`translator-state-v3`、`translator-settings-v1`）

### 4.3 OCR 图片识别 — [public/app.js](translator/public/app.js)
- 从 CDN（`cdn.jsdelivr.net/npm/tesseract.js@5`）**动态加载** tesseract.js
- ⚠️ **离线不可用**，且依赖外网 CDN；桌面离线场景 OCR 会失效

### 4.4 自动更新 — [electron-main.js](translator/electron-main.js) + [preload.js](translator/preload.js)
- 主进程 IPC 处理器：`get-app-version` / `check-for-updates` / `download-update` / `install-update`
- 下载进度通过 `download-progress` 事件推送到渲染进程
- 更新源：GitHub Releases（`X-1784/translator`）

### 4.5 托盘 / 单实例 — [electron-main.js](translator/electron-main.js)
- `createTray()`：系统托盘（显示窗口 / 隐藏 / 检查更新 / 退出）
- `requestSingleInstanceLock()`：单实例锁，重复启动时聚焦已有窗口

---

## 5. 本地开发指南

### preload.js 暴露的 API（`window.electronAPI`）

| 方法 | IPC 通道 | 作用 |
|------|---------|------|
| `getAppVersion()` | `get-app-version` | 获取当前版本号 |
| `checkForUpdates()` | `check-for-updates` | 检查更新 |
| `downloadUpdate()` | `download-update` | 下载更新 |
| `installUpdate()` | `install-update` | 安装并重启 |
| `onDownloadProgress(cb)` | `download-progress` | 订阅下载进度 |

> Web 版没有这些 API，`app.js` 会通过 `window.electronAPI` 存在性检查自动降级（如版本号显示）。

### 环境变量
| 变量 | 默认值 | 作用 |
|------|--------|------|
| `PORT` | `3000` | 本地服务端口（被占用自动 +1） |
| `TRANSLATION_TIMEOUT_MS` | `8000` | 翻译请求超时（毫秒） |

### 修改生效方式
- **改前端**（public/ 下）：Web 版刷新即生效；桌面版重启应用
- **改主进程**（electron-main.js / app-server.js）：需重启应用

---

## 6. 打包

```bash
# 生成安装版(Setup) + 便携版(Portable)
npm run build:win

# 仅生成解压目录（调试用）
npm run pack:win   # → dist/win-unpacked/
```

产物位于 `dist/`：
| 文件 | 说明 |
|------|------|
| `XiaoJian-Translator-Setup-{ver}.exe` | 安装版（可改安装目录） |
| `XiaoJian-Translator-Setup-{ver}.exe.blockmap` | 增量更新块映射 |
| `XiaoJian-Translator-Portable-{ver}.exe` | 便携版 |
| `latest.yml` | **electron-updater 更新清单，发布时必须上传** |

> Electron 二进制通过 npmmirror 镜像下载（`build.electronDownload.mirror`），打包速度快。

---

## 7. 发布新版本（完整流程）

> 参考实例：v1.0.8 发布（2026-08-04）。CI 自动发布工作流已移除，**当前为本地手动发布**。

**前置**：`gh` CLI 已登录（`gh auth status` 确认），网络可访问 GitHub。

### 步骤

**① 改版本号**（3 处）：
- [package.json](translator/package.json) → `"version": "1.0.8"`
- [public/index.html](translator/public/index.html) → 侧边栏 `<p class="sidebar-version">v1.0.8</p>`
- [public/index.html](translator/public/index.html) → 关于页 `<p class="about-version">版本 1.0.8</p>`

**② 提交代码**：
```bash
git add .
git commit -m "fix: 更新说明 (v1.0.8)"
```

**③ 打标签**：
```bash
git tag v1.0.8
```

**④ 推送**（remote 为 `git@github.com:x-1784/translator.git`）：
```bash
git push origin main --tags
```

**⑤ 本地构建**：
```bash
npm run build:win
```

**⑥ 创建 Release 并上传产物**：
```bash
gh release create v1.0.8 \
  "dist/XiaoJian-Translator-Setup-1.0.8.exe" \
  "dist/XiaoJian-Translator-Setup-1.0.8.exe.blockmap" \
  "dist/XiaoJian-Translator-Portable-1.0.8.exe" \
  "dist/latest.yml" \
  --repo x-1784/translator \
  --title "v1.0.8" \
  --notes "更新说明"
```

**⑦ ⚠️ 最重要**：**必须上传 `latest.yml`**。

- 它是 electron-updater 检查更新的清单文件
- **只传 exe 不传 latest.yml → 应用内「检查更新」检测不到新版本**
- 用户从旧版本打开应用 → 设置 → 检查更新 → 即可发现并下载新版本

---

## 8. 已知问题与注意事项

| # | 问题 | 说明 | 建议 |
|---|------|------|------|
| 1 | **品牌不一致** | [electron-main.js](translator/electron-main.js) 内 `APP_NAME="FluxTranslate"`、`app.setAppUserModelId("com.fluxtranslate.desktop")`，与 build 配置（XiaoJian-Translator / com.xiaojian.translator）不一致 | 统一品牌名 |
| 2 | **electron 版本坑** | 本地 `node_modules` 的 electron 是 24.x，与声明 ^43 不符（见第 2 章） | 重装 electron@^43 |
| 3 | **tesseract.js 版本不一致** | dependencies 声明 `@7`，实际 CDN 加载 `@5` | 统一版本；考虑本地打包以支持离线 OCR |
| 4 | **OCR 离线失效** | OCR 走 CDN 动态加载，桌面离线不可用 | 依赖外网，评估必要性 |
| 5 | **MyMemory 限额** | 免费 API 有每日/频率限制 | 量大需换引擎或加缓存 |
| 6 | **更新依赖 GitHub 可达** | 自动更新需访问 github.com + objects.githubusercontent.com | 国内网络需确认可达 |

---

## 9. 遗留 / 废弃文件清单（可清理）

| 文件/目录 | 说明 |
|-----------|------|
| `server.js` | 废弃独立服务器（旧 Google API 版），无任何文件引用 |
| `public/index-fixed.html` | 旧版 UI（FluxTranslate），无入口引用 |
| `public/app-fixed.js` | 早期简化版前端，仅被 index-fixed.html 引用 |
| `.github/workflows/` | 空目录（CI 自动发布工作流已移除） |
| `dist/` 中 `FluxTranslate-*` / 旧品牌版本 exe | 过期安装包 |
| `server.err.log` / `server.out.log` | 空日志文件（已被 .gitignore 忽略） |
| `.agents/` | 空目录 |
| dependencies 中 `tesseract.js` | 声明了但实际未 require（走 CDN） |

> 清理前请先确认历史 Release 里已保留对应的旧版本安装包（用户可能还在用旧版）。

---

## 10. 下一步建议（待办）

- [ ] 统一品牌名：`FluxTranslate` → `小简翻译`（electron-main.js + appId）
- [ ] 重装本地 electron 到 ^43，消除启动报错
- [ ] 清理第 9 章的遗留文件
- [ ] 统一 tesseract.js 版本，评估离线 OCR 方案
- [ ] 决定是否恢复 GitHub Actions 自动发布工作流（推送 tag 即自动构建发布）
- [ ] 补充单元测试（当前项目无任何测试）

---

*本交接文档生成于 2026-08-04，基于 v1.0.8 项目状态。*
