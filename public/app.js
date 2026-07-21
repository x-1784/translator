const LANGUAGES = [
  ["auto", "自动检测"],
  ["zh-CN", "中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ru", "Русский"],
  ["pt", "Português"],
  ["it", "Italiano"],
  ["ar", "العربية"],
  ["th", "ไทย"],
  ["vi", "Tiếng Việt"],
];

const STORAGE_KEY = "translator-history-v3";
const STATE_KEY = "translator-state-v3";
const SETTINGS_KEY = "translator-settings-v1";

const els = {
  navItems: document.querySelectorAll(".nav-item"),
  pages: document.querySelectorAll(".page"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  sourceText: document.getElementById("sourceText"),
  output: document.getElementById("output"),
  translateBtn: document.getElementById("translateBtn"),
  swapBtn: document.getElementById("swapBtn"),
  clearBtn: document.getElementById("clearBtn"),
  copyBtn: document.getElementById("copyBtn"),
  statusText: document.getElementById("statusText"),
  detectedText: document.getElementById("detectedText"),
  lastUpdated: document.getElementById("lastUpdated"),
  sourceCount: document.getElementById("sourceCount"),
  targetCount: document.getElementById("targetCount"),
  historyList: document.getElementById("historyList"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  historySearch: document.getElementById("historySearch"),
  filterSource: document.getElementById("filterSource"),
  filterTarget: document.getElementById("filterTarget"),
  filterFavorite: document.getElementById("filterFavorite"),
  checkUpdateBtn: document.getElementById("checkUpdateBtn"),
  updateInfo: document.getElementById("updateInfo"),
  defaultSourceLang: document.getElementById("defaultSourceLang"),
  defaultTargetLang: document.getElementById("defaultTargetLang"),
  exportHistoryBtn: document.getElementById("exportHistoryBtn"),
  importHistoryBtn: document.getElementById("importHistoryBtn"),
  importHistoryInput: document.getElementById("importHistoryInput"),
  clearAllDataBtn: document.getElementById("clearAllDataBtn"),
};

const languageNames = Object.fromEntries(LANGUAGES);
let history = loadHistory();
let settings = loadSettings();

function init() {
  populateLanguageSelects();
  restoreState();
  wireEvents();
  renderHistory();
  updateCounts();
  setStatus("准备就绪");
  applySettings();
}

function switchPage(pageId) {
  els.navItems.forEach((item) => {
    if (item.dataset.page === pageId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  els.pages.forEach((page) => {
    if (page.id === `page-${pageId}`) {
      page.classList.add("active");
    } else {
      page.classList.remove("active");
    }
  });

  if (pageId === "history") {
    renderHistory();
  }
}

function populateLanguageSelects() {
  for (const [code, label] of LANGUAGES) {
    els.sourceLang.appendChild(createOption(code, label));
    els.targetLang.appendChild(createOption(code, label));

    if (code !== "auto") {
      els.defaultSourceLang.appendChild(createOption(code, label));
      els.defaultTargetLang.appendChild(createOption(code, label));
    }
  }

  els.sourceLang.value = settings.defaultSourceLang || "auto";
  els.targetLang.value = settings.defaultTargetLang || "en";
  els.defaultSourceLang.value = settings.defaultSourceLang || "auto";
  els.defaultTargetLang.value = settings.defaultTargetLang || "en";
}

function createOption(code, label) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = label;
  return option;
}

async function translate() {
  const text = els.sourceText.value.trim();
  const source = els.sourceLang.value;
  const target = els.targetLang.value;

  if (!text) {
    setStatus("请输入要翻译的文本", "danger");
    return;
  }

  if (source === target && source !== "auto") {
    setStatus("源语言和目标语言不能相同", "danger");
    return;
  }

  els.translateBtn.disabled = true;
  els.output.classList.add("loading");
  setStatus("正在翻译中...");

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, target }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "翻译失败");
    }

    setOutput(payload.translatedText, { detectedSource: payload.detectedSource });
    setStatus(`翻译完成 (${payload.provider || "默认服务"})`, "success");

    pushHistory({
      source: payload.detectedSource || source,
      target,
      sourceText: text,
      translatedText: payload.translatedText,
      time: new Date().toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "翻译失败";
    setStatus(message, "danger");
  } finally {
    els.translateBtn.disabled = false;
    els.output.classList.remove("loading");
    persistState();
  }
}

function setOutput(text, meta = {}) {
  els.output.innerHTML = text
    ? `<div>${escapeHtml(text).replaceAll("\n", "<br />")}</div>`
    : '<p class="placeholder">翻译结果会显示在这里</p>';

  els.detectedText.textContent = `检测语言: ${humanLanguage(meta.detectedSource)}`;
  els.lastUpdated.textContent = `最近更新: ${new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  updateCounts();
}

function setStatus(message, tone = "muted") {
  els.statusText.textContent = message;
  els.statusText.style.color =
    tone === "success" ? "var(--success)" :
    tone === "danger" ? "var(--danger)" :
    "var(--text-muted)";
}

async function copyOutput() {
  const text = els.output.textContent.trim();
  if (!text || text === "翻译结果会显示在这里") {
    setStatus("当前没有可复制的译文", "danger");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("译文已复制到剪贴板", "success");
  } catch {
    setStatus("复制失败，请检查权限", "danger");
  }
}

function swapLanguages() {
  const source = els.sourceLang.value;
  const target = els.targetLang.value;

  if (source === "auto") {
    setStatus("自动检测不能交换，已切换为目标语言");
    els.sourceLang.value = target;
    els.targetLang.value = "en";
  } else {
    els.sourceLang.value = target;
    els.targetLang.value = source;
  }

  persistState();
}

function clearAll() {
  els.sourceText.value = "";
  setOutput("", {});
  setStatus("已清空当前内容");
  persistState();
  updateCounts();
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
}

function pushHistory(entry) {
  history.unshift({ ...entry, favorite: false, id: Date.now() });
  history = history.slice(0, 50);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const searchTerm = els.historySearch?.value.toLowerCase() || "";
  const filterSrc = els.filterSource?.value || "";
  const filterTgt = els.filterTarget?.value || "";
  const filterFav = els.filterFavorite?.value || "";

  let filtered = history.filter((item) => {
    const matchSearch =
      !searchTerm ||
      item.sourceText.toLowerCase().includes(searchTerm) ||
      item.translatedText.toLowerCase().includes(searchTerm);
    const matchSource = !filterSrc || item.source === filterSrc;
    const matchTarget = !filterTgt || item.target === filterTgt;
    const matchFavorite = !filterFav || (filterFav === "favorite" && item.favorite);

    return matchSearch && matchSource && matchTarget && matchFavorite;
  });

  if (!filtered.length) {
    els.historyList.innerHTML = `
      <div class="history-item">
        <p class="placeholder">${history.length ? "未找到匹配的历史记录" : "还没有历史记录"}</p>
      </div>
    `;
    return;
  }

  els.historyList.innerHTML = filtered
    .map(
      (item) => `
        <article class="history-item ${item.favorite ? "favorite" : ""}" data-id="${item.id}">
          <div class="history-top">
            <div class="history-lang">${humanLanguage(item.source)} → ${humanLanguage(item.target)}</div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="history-actions">
                <button class="history-action-btn favorite-btn ${item.favorite ? "active" : ""}" data-id="${item.id}" title="${item.favorite ? "取消收藏" : "收藏"}">
                  ${item.favorite ? "★" : "☆"}
                </button>
                <button class="history-action-btn reuse-btn" data-id="${item.id}" title="重新编辑">
                  ↻
                </button>
              </div>
              <div class="history-meta" title="${item.time}">${getRelativeTime(item.id)}</div>
            </div>
          </div>
          <p class="history-source">${escapeHtml(item.sourceText)}</p>
          <p class="history-target">${escapeHtml(item.translatedText)}</p>
        </article>
      `,
    )
    .join("");

  // 绑定收藏按钮事件
  document.querySelectorAll(".favorite-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(Number(btn.dataset.id));
    });
  });

  // 绑定重新编辑按钮事件
  document.querySelectorAll(".reuse-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      reuseHistoryItem(Number(btn.dataset.id));
    });
  });

  // 更新筛选器选项
  updateFilterOptions();
}

function toggleFavorite(id) {
  const item = history.find((h) => h.id === id);
  if (item) {
    item.favorite = !item.favorite;
    saveHistory();
    renderHistory();
  }
}

function reuseHistoryItem(id) {
  const item = history.find((h) => h.id === id);
  if (!item) return;

  // 切换到首页
  switchPage("translate");

  // 填充表单
  els.sourceLang.value = item.source;
  els.targetLang.value = item.target;
  els.sourceText.value = item.sourceText;
  setOutput(item.translatedText, { detectedSource: item.source });

  persistState();
  setStatus("已加载历史记录，可以重新编辑和翻译");
}

function updateFilterOptions() {
  if (!els.filterSource || !els.filterTarget) return;

  const sources = new Set();
  const targets = new Set();

  history.forEach((item) => {
    if (item.source && item.source !== "auto") sources.add(item.source);
    if (item.target) targets.add(item.target);
  });

  els.filterSource.innerHTML =
    '<option value="">所有源语言</option>' +
    Array.from(sources)
      .map((lang) => `<option value="${lang}">${humanLanguage(lang)}</option>`)
      .join("");

  els.filterTarget.innerHTML =
    '<option value="">所有目标语言</option>' +
    Array.from(targets)
      .map((lang) => `<option value="${lang}">${humanLanguage(lang)}</option>`)
      .join("");
}

function clearHistory() {
  if (!confirm("确定要清空所有历史记录吗？")) return;
  history = [];
  saveHistory();
  renderHistory();
  setStatus("历史记录已清空", "success");
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings() {
  if (settings.defaultSourceLang) {
    els.sourceLang.value = settings.defaultSourceLang;
  }
  if (settings.defaultTargetLang) {
    els.targetLang.value = settings.defaultTargetLang;
  }
}

function updateSettings() {
  settings.defaultSourceLang = els.defaultSourceLang.value;
  settings.defaultTargetLang = els.defaultTargetLang.value;
  saveSettings();
  applySettings();
  setStatus("设置已保存", "success");
}

async function checkForUpdates() {
  els.checkUpdateBtn.disabled = true;
  els.checkUpdateBtn.textContent = "检查中...";
  els.updateInfo.style.display = "none";

  try {
    // 检查是否在 Electron 环境中
    if (!window.electronAPI || !window.electronAPI.checkForUpdates) {
      throw new Error("此功能仅在桌面应用中可用");
    }

    const result = await window.electronAPI.checkForUpdates();

    if (!result.success) {
      els.updateInfo.innerHTML = `<p>❌ ${result.message}</p>`;
      els.updateInfo.className = "update-info";
    } else if (result.isLatest) {
      els.updateInfo.innerHTML = `<p>✅ 当前已是最新版本 (v${result.version})</p>`;
      els.updateInfo.className = "update-info success";
    } else {
      els.updateInfo.innerHTML = `
        <p><strong>检测到新版本: v${result.latestVersion}</strong></p>
        <p>当前版本: v${result.currentVersion}</p>
        <p style="margin-top: 12px;">
          <button id="downloadUpdateBtn" class="secondary-btn" style="margin-right: 8px;">下载更新</button>
          <button id="cancelUpdateBtn" class="secondary-btn">稍后再说</button>
        </p>
      `;
      els.updateInfo.className = "update-info warning";

      // 绑定下载按钮事件
      document.getElementById("downloadUpdateBtn").addEventListener("click", downloadUpdate);
      document.getElementById("cancelUpdateBtn").addEventListener("click", () => {
        els.updateInfo.style.display = "none";
      });
    }
    els.updateInfo.style.display = "block";
  } catch (error) {
    els.updateInfo.innerHTML = `<p>❌ ${error.message}</p>`;
    els.updateInfo.className = "update-info";
    els.updateInfo.style.display = "block";
  } finally {
    els.checkUpdateBtn.disabled = false;
    els.checkUpdateBtn.textContent = "检查更新";
  }
}

async function downloadUpdate() {
  const downloadBtn = document.getElementById("downloadUpdateBtn");
  downloadBtn.disabled = true;
  downloadBtn.textContent = "准备下载...";

  // 显示进度条
  const progressContainer = document.getElementById("downloadProgress");
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const progressText = document.getElementById("progressText");
  const progressSpeed = document.getElementById("progressSpeed");

  progressContainer.style.display = "block";
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressText.textContent = "正在下载...";
  progressSpeed.textContent = "";

  // 监听下载进度
  window.electronAPI.onDownloadProgress((progress) => {
    const percent = Math.floor(progress.percent);
    progressBar.style.width = percent + "%";
    progressPercent.textContent = percent + "%";

    // 格式化下载速度
    const speed = (progress.bytesPerSecond / 1024 / 1024).toFixed(2);
    const transferred = (progress.transferred / 1024 / 1024).toFixed(2);
    const total = (progress.total / 1024 / 1024).toFixed(2);
    progressSpeed.textContent = `${transferred}MB / ${total}MB  •  ${speed}MB/s`;
  });

  try {
    const result = await window.electronAPI.downloadUpdate();

    // 隐藏进度条
    progressContainer.style.display = "none";

    if (result.success) {
      els.updateInfo.innerHTML = `
        <p>✅ 更新已下载完成</p>
        <p style="margin-top: 12px;">
          <button id="installUpdateBtn" class="secondary-btn" style="margin-right: 8px;">立即重启安装</button>
          <button id="laterInstallBtn" class="secondary-btn">稍后重启</button>
        </p>
      `;

      document.getElementById("installUpdateBtn").addEventListener("click", () => {
        window.electronAPI.installUpdate();
      });
      document.getElementById("laterInstallBtn").addEventListener("click", () => {
        els.updateInfo.style.display = "none";
      });
    } else {
      els.updateInfo.innerHTML = `<p>❌ 下载失败: ${result.message}</p>`;
    }
  } catch (error) {
    els.updateInfo.innerHTML = `<p>❌ 下载失败: ${error.message}</p>`;
  }
}

function exportHistory() {
  if (!history.length) {
    alert("没有历史记录可以导出");
    return;
  }

  const dataStr = JSON.stringify(history, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `translation-history-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("历史记录已导出", "success");
}

function importHistory() {
  const file = els.importHistoryInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) {
        alert("文件格式错误，必须是 JSON 数组");
        return;
      }

      // 合并导入的历史，去重（基于 id）
      const existingIds = new Set(history.map((h) => h.id));
      const newItems = imported.filter((item) => {
        // 确保必要字段存在
        if (!item.sourceText || !item.translatedText) return false;
        // 如果没有 id，生成一个
        if (!item.id) item.id = Date.now() + Math.random();
        // 确保有 favorite 字段
        if (item.favorite === undefined) item.favorite = false;
        // 去重
        return !existingIds.has(item.id);
      });

      history = [...newItems, ...history].slice(0, 100);
      saveHistory();
      renderHistory();
      alert(`成功导入 ${newItems.length} 条历史记录`);
      setStatus(`已导入 ${newItems.length} 条历史记录`, "success");
    } catch (error) {
      alert("导入失败：" + error.message);
      setStatus("导入失败", "error");
    }
  };
  reader.readAsText(file);

  // 清空 input，允许重复选择同一文件
  els.importHistoryInput.value = "";
}

function clearAllData() {
  if (!confirm("确定要清除所有数据吗？此操作不可恢复！")) return;

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(SETTINGS_KEY);

  history = [];
  settings = {};

  renderHistory();
  setStatus("所有数据已清除", "success");

  setTimeout(() => location.reload(), 1000);
}

function persistState() {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      sourceLang: els.sourceLang.value,
      targetLang: els.targetLang.value,
      sourceText: els.sourceText.value,
    }),
  );
}

function restoreState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return;

  try {
    const state = JSON.parse(raw);
    if (state.sourceLang) els.sourceLang.value = state.sourceLang;
    if (state.targetLang) els.targetLang.value = state.targetLang;
    if (typeof state.sourceText === "string") els.sourceText.value = state.sourceText;
  } catch {
    localStorage.removeItem(STATE_KEY);
  }
}

function updateCounts() {
  els.sourceCount.textContent = String(els.sourceText.value.trim().length);
  els.targetCount.textContent = String(els.output.textContent.trim().length);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  // 超过7天显示具体日期
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function humanLanguage(code) {
  return languageNames[code] || code || "-";
}

function wireEvents() {
  els.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      switchPage(item.dataset.page);
    });
  });

  els.translateBtn.addEventListener("click", translate);
  els.swapBtn.addEventListener("click", swapLanguages);
  els.clearBtn.addEventListener("click", clearAll);
  els.copyBtn.addEventListener("click", copyOutput);

  els.sourceText.addEventListener("input", () => {
    persistState();
    updateCounts();
  });
  els.sourceLang.addEventListener("change", persistState);
  els.targetLang.addEventListener("change", persistState);

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      translate();
    }
  });

  els.clearHistoryBtn.addEventListener("click", clearHistory);

  // 历史记录搜索和筛选
  if (els.historySearch) {
    els.historySearch.addEventListener("input", renderHistory);
  }
  if (els.filterSource) {
    els.filterSource.addEventListener("change", renderHistory);
  }
  if (els.filterTarget) {
    els.filterTarget.addEventListener("change", renderHistory);
  }
  if (els.filterFavorite) {
    els.filterFavorite.addEventListener("change", renderHistory);
  }

  els.checkUpdateBtn.addEventListener("click", checkForUpdates);
  els.defaultSourceLang.addEventListener("change", updateSettings);
  els.defaultTargetLang.addEventListener("change", updateSettings);
  els.exportHistoryBtn.addEventListener("click", exportHistory);
  els.importHistoryBtn.addEventListener("click", () => els.importHistoryInput.click());
  els.importHistoryInput.addEventListener("change", importHistory);
  els.clearAllDataBtn.addEventListener("click", clearAllData);
}

init();
