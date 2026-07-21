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

  // 加载当前版本号
  if (window.electronAPI && window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(version => {
      const versionEl = document.getElementById('currentVersion');
      if (versionEl) {
        versionEl.textContent = `v${version}`;
      }
    });
  }
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

  if (pageId === "stats") {
    renderStats();
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

    // 应用自定义术语替换
    let finalText = payload.translatedText;
    if (customTerms.length > 0) {
      finalText = applyCustomTerms(finalText);
    }

    setOutput(finalText, { detectedSource: payload.detectedSource });
    setStatus(`翻译完成 (${payload.provider || "默认服务"})`, "success");

    // 自动朗读
    if (autoSpeakEnabled && finalText) {
      speakText(finalText);
    }

    pushHistory({
      source: payload.detectedSource || source,
      target,
      sourceText: text,
      translatedText: finalText,
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

    // 视觉反馈：按钮变绿并显示"已复制✓"
    const originalContent = els.copyBtn.innerHTML;
    els.copyBtn.innerHTML = "✓";
    els.copyBtn.style.background = "#10b981";
    els.copyBtn.style.transform = "scale(1.1)";

    // 2秒后恢复原样
    setTimeout(() => {
      els.copyBtn.innerHTML = originalContent;
      els.copyBtn.style.background = "";
      els.copyBtn.style.transform = "";
    }, 2000);
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
  const filterTagValue = document.getElementById("filterTag")?.value || "";

  let filtered = history.filter((item) => {
    const matchSearch =
      !searchTerm ||
      item.sourceText.toLowerCase().includes(searchTerm) ||
      item.translatedText.toLowerCase().includes(searchTerm);
    const matchSource = !filterSrc || item.source === filterSrc;
    const matchTarget = !filterTgt || item.target === filterTgt;
    const matchFavorite = !filterFav || (filterFav === "favorite" && item.favorite);
    const matchTag = !filterTagValue || (item.tags && item.tags.includes(filterTagValue));

    return matchSearch && matchSource && matchTarget && matchFavorite && matchTag;
  });

  // 更新标签筛选选项
  updateTagFilter();

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
                <button class="history-action-btn tag-btn" data-id="${item.id}" title="添加标签">
                  🏷️
                </button>
              </div>
              <div class="history-meta" title="${item.time}">${getRelativeTime(item.id)}</div>
            </div>
          </div>
          ${item.tags && item.tags.length ? `
            <div class="history-tags">
              ${item.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
          ` : ''}
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

  // 绑定标签按钮事件
  document.querySelectorAll(".tag-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showTagDialog(Number(btn.dataset.id));
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
  // 先获取并显示当前版本
  if (window.electronAPI && window.electronAPI.getAppVersion) {
    const version = await window.electronAPI.getAppVersion();
    const versionEl = document.getElementById('currentVersion');
    if (versionEl) {
      versionEl.textContent = `v${version}`;
    }
  }

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
  const sourceLength = els.sourceText.value.trim().length;
  const targetLength = els.output.textContent.trim().length;

  els.sourceCount.textContent = String(sourceLength);
  els.targetCount.textContent = String(targetLength);

  // 字数限制提示（5000字符）
  if (sourceLength > 5000) {
    els.sourceCount.style.color = "#ef4444";
    els.sourceCount.title = "文本过长，建议使用文档翻译功能";
  } else if (sourceLength > 4000) {
    els.sourceCount.style.color = "#f59e0b";
    els.sourceCount.title = "文本较长";
  } else {
    els.sourceCount.style.color = "";
    els.sourceCount.title = "";
  }
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

  const speakBtn = document.getElementById("speakBtn");
  if (speakBtn) {
    speakBtn.addEventListener("click", () => {
      const text = els.output.textContent.trim();
      if (text && text !== "翻译结果会显示在这里") {
        speakText(text);
        setStatus("正在朗读...", "success");
      }
    });
  }

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
  const filterTag = document.getElementById("filterTag");
  if (filterTag) {
    filterTag.addEventListener("change", renderHistory);
  }

  els.checkUpdateBtn.addEventListener("click", checkForUpdates);
  els.defaultSourceLang.addEventListener("change", updateSettings);
  els.defaultTargetLang.addEventListener("change", updateSettings);
  els.exportHistoryBtn.addEventListener("click", exportHistory);
  els.importHistoryBtn.addEventListener("click", () => els.importHistoryInput.click());
  els.importHistoryInput.addEventListener("change", importHistory);
  els.clearAllDataBtn.addEventListener("click", clearAllData);

  // 文档翻译功能
  initDocumentTranslation();

  // 术语管理功能
  initTermsManagement();

  // 剪贴板监听和朗读功能
  initFeatures();

  // 图片OCR功能
  initImageOCR();
}

// 图片OCR功能
function initImageOCR() {
  const uploadImageBtn = document.getElementById("uploadImageBtn");
  const imageInput = document.getElementById("imageInput");
  const imagePreview = document.getElementById("imagePreview");
  const previewImg = document.getElementById("previewImg");
  const removeImageBtn = document.getElementById("removeImageBtn");
  const ocrProgress = document.getElementById("ocrProgress");
  const sourceText = els.sourceText;

  if (!uploadImageBtn) return;

  // 点击上传按钮
  uploadImageBtn.addEventListener("click", () => {
    imageInput.click();
  });

  // 文件选择
  imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      handleImageFile(file);
    }
  });

  // 粘贴图片
  sourceText.addEventListener("paste", (e) => {
    const items = e.clipboardData.items;
    for (let item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        handleImageFile(file);
        break;
      }
    }
  });

  // 拖拽上传
  sourceText.addEventListener("dragover", (e) => {
    e.preventDefault();
    sourceText.style.borderColor = "var(--accent-primary)";
  });

  sourceText.addEventListener("dragleave", () => {
    sourceText.style.borderColor = "";
  });

  sourceText.addEventListener("drop", (e) => {
    e.preventDefault();
    sourceText.style.borderColor = "";

    const file = e.dataTransfer.files[0];
    if (file && file.type.indexOf("image") !== -1) {
      handleImageFile(file);
    }
  });

  // 移除图片
  removeImageBtn.addEventListener("click", () => {
    imagePreview.style.display = "none";
    previewImg.src = "";
    imageInput.value = "";
  });

  async function handleImageFile(file) {
    if (file.size > 10 * 1024 * 1024) {
      setStatus("图片大小不能超过 10MB", "danger");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      imagePreview.style.display = "block";
    };
    reader.readAsDataURL(file);

    try {
      ocrProgress.style.display = "block";
      setStatus("正在识别图片中的文字...", "success");

      const text = await recognizeImage(file);

      if (text && text.trim()) {
        sourceText.value = text.trim();
        updateCounts();
        setStatus("文字识别完成！", "success");
      } else {
        setStatus("未识别到文字内容", "danger");
      }
    } catch (error) {
      console.error("OCR识别失败:", error);
      setStatus("图片识别失败: " + error.message, "danger");
    } finally {
      ocrProgress.style.display = "none";
    }
  }

  async function recognizeImage(file) {
    if (!window.Tesseract) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
      });
    }

    const { createWorker } = window.Tesseract;
    const worker = await createWorker('chi_sim+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const percent = Math.round(m.progress * 100);
          const progressText = document.querySelector('.progress-text');
          if (progressText) {
            progressText.textContent = `识别中... ${percent}%`;
          }
        }
      }
    });

    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();

    return text;
  }
}

// 剪贴板监听和朗读功能
function initFeatures() {
  const clipboardMonitor = document.getElementById("clipboardMonitor");
  const autoSpeak = document.getElementById("autoSpeak");

  if (clipboardMonitor) {
    clipboardMonitor.checked = clipboardMonitorEnabled;
    clipboardMonitor.addEventListener("change", (e) => {
      clipboardMonitorEnabled = e.target.checked;
      localStorage.setItem("clipboardMonitor", clipboardMonitorEnabled);
      if (clipboardMonitorEnabled) {
        startClipboardMonitor();
        setStatus("剪贴板监听已启用", "success");
      } else {
        setStatus("剪贴板监听已关闭", "success");
      }
    });

    if (clipboardMonitorEnabled) {
      startClipboardMonitor();
    }
  }

  if (autoSpeak) {
    autoSpeak.checked = autoSpeakEnabled;
    autoSpeak.addEventListener("change", (e) => {
      autoSpeakEnabled = e.target.checked;
      localStorage.setItem("autoSpeak", autoSpeakEnabled);
      setStatus(autoSpeakEnabled ? "自动朗读已启用" : "自动朗读已关闭", "success");
    });
  }
}

function startClipboardMonitor() {
  if (!clipboardMonitorEnabled) return;

  setInterval(async () => {
    if (!clipboardMonitorEnabled) return;

    try {
      const text = await navigator.clipboard.readText();
      if (text && text !== lastClipboardText && text.length > 0 && text.length < 1000) {
        lastClipboardText = text;
        switchPage("home");
        els.sourceText.value = text;
        updateCounts();
        setTimeout(() => translate(), 300);
      }
    } catch (err) {
      // 静默失败
    }
  }, 2000);
}

function speakText(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }
}

// 文档翻译相关
let currentFile = null;

// 术语库
let customTerms = JSON.parse(localStorage.getItem("customTerms") || "[]");

// 标签系统
let availableTags = JSON.parse(localStorage.getItem("availableTags") || '["工作", "学习", "生活"]');

// 功能配置
let clipboardMonitorEnabled = localStorage.getItem("clipboardMonitor") === "true";
let autoSpeakEnabled = localStorage.getItem("autoSpeak") === "true";
let lastClipboardText = "";

function initDocumentTranslation() {
  const uploadBox = document.getElementById("uploadBox");
  const documentFile = document.getElementById("documentFile");
  const documentControls = document.getElementById("documentControls");
  const removeFileBtn = document.getElementById("removeFileBtn");
  const translateDocBtn = document.getElementById("translateDocBtn");
  const copyDocResultBtn = document.getElementById("copyDocResultBtn");
  const downloadDocResultBtn = document.getElementById("downloadDocResultBtn");

  if (!uploadBox) return;

  // 点击上传区域
  uploadBox.addEventListener("click", () => documentFile.click());

  // 文件选择
  documentFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  });

  // 拖拽上传
  uploadBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadBox.classList.add("dragging");
  });

  uploadBox.addEventListener("dragleave", () => {
    uploadBox.classList.remove("dragging");
  });

  uploadBox.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadBox.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });

  // 移除文件
  removeFileBtn.addEventListener("click", () => {
    currentFile = null;
    documentFile.value = "";
    uploadBox.style.display = "block";
    documentControls.style.display = "none";
    document.getElementById("docResult").style.display = "none";
  });

  // 翻译文档
  translateDocBtn.addEventListener("click", translateDocument);

  // 复制结果
  copyDocResultBtn.addEventListener("click", async () => {
    const text = document.getElementById("docResultText").textContent;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("翻译结果已复制", "success");
    } catch {
      setStatus("复制失败", "danger");
    }
  });

  // 下载结果
  downloadDocResultBtn.addEventListener("click", () => {
    const text = document.getElementById("docResultText").textContent;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translated_${currentFile.name.replace(/\.[^.]+$/, ".txt")}`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function handleFileSelect(file) {
  // 检查文件类型
  const validTypes = [".txt", ".pdf"];
  const fileExt = "." + file.name.split(".").pop().toLowerCase();

  if (!validTypes.includes(fileExt)) {
    setStatus("仅支持 TXT 和 PDF 格式", "danger");
    return;
  }

  // 检查文件大小（10MB）
  if (file.size > 10 * 1024 * 1024) {
    setStatus("文件大小不能超过 10MB", "danger");
    return;
  }

  currentFile = file;

  // 显示文件信息
  document.getElementById("fileName").textContent = file.name;
  document.getElementById("fileSize").textContent = formatFileSize(file.size);
  document.getElementById("uploadBox").style.display = "none";
  document.getElementById("documentControls").style.display = "block";
  document.getElementById("docResult").style.display = "none";
}

async function translateDocument() {
  if (!currentFile) return;

  const translateDocBtn = document.getElementById("translateDocBtn");
  const docProgress = document.getElementById("docProgress");
  const docProgressBar = document.getElementById("docProgressBar");
  const docProgressPercent = document.getElementById("docProgressPercent");
  const docProgressText = document.getElementById("docProgressText");
  const docResult = document.getElementById("docResult");
  const docResultText = document.getElementById("docResultText");

  translateDocBtn.disabled = true;
  translateDocBtn.textContent = "正在读取文件...";
  docProgress.style.display = "block";
  docProgressBar.style.width = "0%";
  docProgressPercent.textContent = "0%";
  docResult.style.display = "none";

  try {
    // 读取文件内容
    const text = await readFileContent(currentFile);

    if (!text || text.trim().length === 0) {
      throw new Error("文件内容为空");
    }

    docProgressText.textContent = "正在翻译...";
    docProgressBar.style.width = "30%";
    docProgressPercent.textContent = "30%";

    // 分段翻译（每段最多1000字符）
    const segments = splitTextIntoSegments(text, 1000);
    const translatedSegments = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const sourceLang = document.getElementById("docSourceLang").value;
      const targetLang = document.getElementById("docTargetLang").value;

      const translated = await translateText(segment, sourceLang, targetLang);
      translatedSegments.push(translated);

      // 更新进度
      const progress = 30 + Math.floor((i + 1) / segments.length * 70);
      docProgressBar.style.width = progress + "%";
      docProgressPercent.textContent = progress + "%";
      docProgressText.textContent = `正在翻译... (${i + 1}/${segments.length})`;
    }

    // 显示结果
    docProgressBar.style.width = "100%";
    docProgressPercent.textContent = "100%";
    docProgressText.textContent = "翻译完成！";

    docResultText.textContent = translatedSegments.join("\n\n");
    docResult.style.display = "block";

    setTimeout(() => {
      docProgress.style.display = "none";
    }, 1500);

    setStatus("文档翻译完成", "success");
  } catch (error) {
    setStatus("翻译失败: " + error.message, "danger");
    docProgress.style.display = "none";
  } finally {
    translateDocBtn.disabled = false;
    translateDocBtn.textContent = "开始翻译";
  }
}

async function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target.result;

      // 如果是PDF，提取文本（简单处理）
      if (file.name.toLowerCase().endsWith(".pdf")) {
        // 注意：这里只是简单的文本提取，实际PDF可能需要专门的库
        resolve(content);
      } else {
        // TXT文件直接返回
        resolve(content);
      }
    };

    reader.onerror = () => reject(new Error("文件读取失败"));

    if (file.name.toLowerCase().endsWith(".pdf")) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file, "UTF-8");
    }
  });
}

function splitTextIntoSegments(text, maxLength) {
  const segments = [];
  const paragraphs = text.split(/\n+/);
  let currentSegment = "";

  for (const para of paragraphs) {
    if (currentSegment.length + para.length + 1 > maxLength) {
      if (currentSegment) {
        segments.push(currentSegment.trim());
        currentSegment = "";
      }

      // 如果单个段落超长，进一步分割
      if (para.length > maxLength) {
        for (let i = 0; i < para.length; i += maxLength) {
          segments.push(para.slice(i, i + maxLength));
        }
      } else {
        currentSegment = para;
      }
    } else {
      currentSegment += (currentSegment ? "\n" : "") + para;
    }
  }

  if (currentSegment) {
    segments.push(currentSegment.trim());
  }

  return segments.filter(s => s.length > 0);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

// 术语管理功能
function initTermsManagement() {
  const manageTermsBtn = document.getElementById("manageTermsBtn");
  const termsModal = document.getElementById("termsModal");
  const closeTermsModal = document.getElementById("closeTermsModal");
  const addTermBtn = document.getElementById("addTermBtn");
  const termSource = document.getElementById("termSource");
  const termTarget = document.getElementById("termTarget");

  if (!manageTermsBtn) return;

  // 打开术语管理
  manageTermsBtn.addEventListener("click", () => {
    termsModal.style.display = "flex";
    renderTerms();
  });

  // 关闭弹窗
  closeTermsModal.addEventListener("click", () => {
    termsModal.style.display = "none";
  });

  // 点击背景关闭
  termsModal.addEventListener("click", (e) => {
    if (e.target === termsModal) {
      termsModal.style.display = "none";
    }
  });

  // 添加术语
  addTermBtn.addEventListener("click", () => {
    const source = termSource.value.trim();
    const target = termTarget.value.trim();

    if (!source || !target) {
      setStatus("请输入源术语和目标译文", "danger");
      return;
    }

    // 检查是否已存在
    const exists = customTerms.some(t => t.source.toLowerCase() === source.toLowerCase());
    if (exists) {
      setStatus("该术语已存在", "danger");
      return;
    }

    customTerms.push({ source, target, id: Date.now() });
    localStorage.setItem("customTerms", JSON.stringify(customTerms));

    termSource.value = "";
    termTarget.value = "";
    renderTerms();
    setStatus("术语添加成功", "success");
  });

  // Enter 键添加
  termTarget.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addTermBtn.click();
    }
  });
}

function renderTerms() {
  const termsList = document.getElementById("termsList");

  if (customTerms.length === 0) {
    termsList.innerHTML = `
      <div style="text-align: center; padding: 40px; opacity: 0.5;">
        <p>还没有添加术语</p>
        <p style="font-size: 14px;">添加专业术语可以确保翻译的准确性和一致性</p>
      </div>
    `;
    return;
  }

  termsList.innerHTML = customTerms.map(term => `
    <div class="term-item">
      <div class="term-text">
        <div class="term-source">${escapeHtml(term.source)}</div>
        <div class="term-target">→ ${escapeHtml(term.target)}</div>
      </div>
      <button class="icon-btn" onclick="deleteTerm(${term.id})" title="删除">🗑️</button>
    </div>
  `).join("");
}

function deleteTerm(id) {
  customTerms = customTerms.filter(t => t.id !== id);
  localStorage.setItem("customTerms", JSON.stringify(customTerms));
  renderTerms();
  setStatus("术语已删除", "success");
}

// 在翻译文本中应用术语替换
function applyCustomTerms(text) {
  let result = text;
  for (const term of customTerms) {
    const regex = new RegExp(term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, term.target);
  }
  return result;
}

// 标签管理功能
function updateTagFilter() {
  const filterTag = document.getElementById("filterTag");
  if (!filterTag) return;

  const currentValue = filterTag.value;
  const allTags = new Set();

  history.forEach(item => {
    if (item.tags) {
      item.tags.forEach(tag => allTags.add(tag));
    }
  });

  filterTag.innerHTML = '<option value="">所有标签</option>' +
    Array.from(allTags).map(tag =>
      `<option value="${escapeHtml(tag)}" ${tag === currentValue ? 'selected' : ''}>${escapeHtml(tag)}</option>`
    ).join('');
}

function showTagDialog(id) {
  const item = history.find(h => h.id === id);
  if (!item) return;

  const currentTags = item.tags || [];
  const tagOptions = availableTags.map(tag =>
    `<label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer;">
      <input type="checkbox" value="${escapeHtml(tag)}" ${currentTags.includes(tag) ? 'checked' : ''} />
      <span>${escapeHtml(tag)}</span>
    </label>`
  ).join('');

  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.style.display = 'flex';
  dialog.innerHTML = `
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h3>管理标签</h3>
        <button class="icon-btn" onclick="this.closest('.modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div id="tagOptions">${tagOptions}</div>
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #1e293b;">
          <input type="text" id="newTagInput" placeholder="添加新标签..." style="width: 100%; padding: 10px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0; margin-bottom: 8px;" />
          <button id="addNewTagBtn" class="secondary-btn" style="width: 100%;">创建新标签</button>
        </div>
        <button id="saveTagsBtn" class="primary-btn" style="width: 100%; margin-top: 16px;">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });

  document.getElementById('addNewTagBtn').addEventListener('click', () => {
    const input = document.getElementById('newTagInput');
    const newTag = input.value.trim();
    if (newTag && !availableTags.includes(newTag)) {
      availableTags.push(newTag);
      localStorage.setItem("availableTags", JSON.stringify(availableTags));

      const tagOptions = document.getElementById('tagOptions');
      tagOptions.innerHTML += `
        <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer;">
          <input type="checkbox" value="${escapeHtml(newTag)}" checked />
          <span>${escapeHtml(newTag)}</span>
        </label>
      `;
      input.value = '';
      setStatus("标签创建成功", "success");
    }
  });

  document.getElementById('saveTagsBtn').addEventListener('click', () => {
    const checkedBoxes = dialog.querySelectorAll('input[type="checkbox"]:checked');
    const selectedTags = Array.from(checkedBoxes).map(cb => cb.value);

    item.tags = selectedTags;
    saveHistory();
    renderHistory();
    dialog.remove();
    setStatus("标签已更新", "success");
  });
}

// 统计功能
function renderStats() {
  // 基础统计
  const totalTransElem = document.getElementById("totalTranslations");
  const totalFavElem = document.getElementById("totalFavorites");
  const totalCharsElem = document.getElementById("totalCharacters");
  const totalTagsElem = document.getElementById("totalTags");

  if (!totalTransElem) return;

  totalTransElem.textContent = history.length;
  totalFavElem.textContent = history.filter(h => h.favorite).length;

  const totalChars = history.reduce((sum, h) => sum + h.sourceText.length + h.translatedText.length, 0);
  totalCharsElem.textContent = totalChars.toLocaleString();

  const uniqueTags = new Set();
  history.forEach(h => {
    if (h.tags) h.tags.forEach(t => uniqueTags.add(t));
  });
  totalTagsElem.textContent = uniqueTags.size;

  // 语言对统计
  const langPairs = {};
  history.forEach(h => {
    const pair = `${humanLanguage(h.source)} → ${humanLanguage(h.target)}`;
    langPairs[pair] = (langPairs[pair] || 0) + 1;
  });

  const sortedPairs = Object.entries(langPairs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCount = sortedPairs[0]?.[1] || 1;

  const langPairStats = document.getElementById("langPairStats");
  if (langPairStats) {
    langPairStats.innerHTML = sortedPairs.length > 0
      ? sortedPairs.map(([pair, count]) => `
          <div class="stat-bar">
            <div class="stat-bar-label">${pair}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width: ${(count / maxCount * 100)}%">${count}次</div>
            </div>
          </div>
        `).join('')
      : '<p style="opacity: 0.5; text-align: center;">暂无数据</p>';
  }

  // 标签统计
  const tagCounts = {};
  history.forEach(h => {
    if (h.tags) {
      h.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });

  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTagCount = sortedTags[0]?.[1] || 1;

  const tagStats = document.getElementById("tagStats");
  if (tagStats) {
    tagStats.innerHTML = sortedTags.length > 0
      ? sortedTags.map(([tag, count]) => `
          <div class="stat-bar">
            <div class="stat-bar-label">${escapeHtml(tag)}</div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill" style="width: ${(count / maxTagCount * 100)}%">${count}次</div>
            </div>
          </div>
        `).join('')
      : '<p style="opacity: 0.5; text-align: center;">暂无标签数据</p>';
  }
}

init();
