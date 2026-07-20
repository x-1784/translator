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

const els = {
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  sourceText: document.getElementById("sourceText"),
  output: document.getElementById("output"),
  translateBtn: document.getElementById("translateBtn"),
  swapBtn: document.getElementById("swapBtn"),
  clearBtn: document.getElementById("clearBtn"),
  copyBtn: document.getElementById("copyBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  statusText: document.getElementById("statusText"),
  detectedText: document.getElementById("detectedText"),
  lastUpdated: document.getElementById("lastUpdated"),
  sourceCount: document.getElementById("sourceCount"),
  targetCount: document.getElementById("targetCount"),
  historyCount: document.getElementById("historyCount"),
  historyList: document.getElementById("historyList"),
};

const languageNames = Object.fromEntries(LANGUAGES);
let history = loadHistory();

function createOption(code, label) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = label;
  return option;
}

function populateLanguageSelects() {
  for (const [code, label] of LANGUAGES) {
    els.sourceLang.appendChild(createOption(code, label));
    els.targetLang.appendChild(createOption(code, label));
  }

  els.sourceLang.value = "auto";
  els.targetLang.value = "en";
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 8)));
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
  if (!raw) {
    return;
  }

  try {
    const state = JSON.parse(raw);
    if (state.sourceLang) els.sourceLang.value = state.sourceLang;
    if (state.targetLang) els.targetLang.value = state.targetLang;
    if (typeof state.sourceText === "string") els.sourceText.value = state.sourceText;
  } catch {
    localStorage.removeItem(STATE_KEY);
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

function humanLanguage(code) {
  return languageNames[code] || code || "-";
}

function renderCounts() {
  els.sourceCount.textContent = String(els.sourceText.value.trim().length);
  els.targetCount.textContent = String(els.output.textContent.trim().length);
  els.historyCount.textContent = String(history.length);
}

function renderHistory() {
  if (!history.length) {
    els.historyList.innerHTML = `
      <div class="history-item">
        <p class="placeholder">还没有历史记录。翻译后会自动显示在这里。</p>
      </div>
    `;
    renderCounts();
    return;
  }

  els.historyList.innerHTML = history
    .map(
      (item) => `
        <article class="history-item">
          <div class="history-top">
            <div class="history-lang">${humanLanguage(item.source)} &rarr; ${humanLanguage(item.target)}</div>
            <div class="history-meta">${item.time}</div>
          </div>
          <p class="history-source">${escapeHtml(item.sourceText)}</p>
          <p class="history-target">${escapeHtml(item.translatedText)}</p>
        </article>
      `,
    )
    .join("");

  renderCounts();
}

function setStatus(message, tone = "muted") {
  els.statusText.textContent = message;
  els.statusText.style.color =
    tone === "good" ? "var(--good)" : tone === "danger" ? "var(--danger)" : "var(--muted)";
}

function setOutput(text, meta = {}) {
  els.output.innerHTML = text
    ? `<div>${escapeHtml(text).replaceAll("\n", "<br />")}</div>`
    : '<p class="placeholder">翻译结果会显示在这里。</p>';

  els.detectedText.textContent = `检测语言：${humanLanguage(meta.detectedSource)}`;
  els.lastUpdated.textContent = `最近更新：${new Date().toLocaleString("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
  renderCounts();
}

function pushHistory(entry) {
  history.unshift(entry);
  history = history.slice(0, 8);
  saveHistory();
  renderHistory();
}

async function translate() {
  const text = els.sourceText.value.trim();
  const source = els.sourceLang.value;
  const target = els.targetLang.value;

  if (!text) {
    setStatus("请输入要翻译的文本。", "danger");
    return;
  }

  if (source === target && source !== "auto") {
    setStatus("源语言和目标语言不能相同。", "danger");
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
      throw new Error(payload.error || "翻译失败。");
    }

    setOutput(payload.translatedText, { detectedSource: payload.detectedSource });
    setStatus(`翻译完成，服务来源：${payload.provider || "默认服务"}。`, "good");

    pushHistory({
      source: payload.detectedSource || source,
      target,
      sourceText: text,
      translatedText: payload.translatedText,
      time: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "翻译失败。";
    setStatus(message, "danger");
  } finally {
    els.translateBtn.disabled = false;
    els.output.classList.remove("loading");
    persistState();
  }
}

async function copyOutput() {
  const text = els.output.textContent.trim();
  if (!text || text === "翻译结果会显示在这里。") {
    setStatus("当前没有可复制的译文。", "danger");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("译文已复制到剪贴板。", "good");
  } catch {
    setStatus("复制失败，请检查系统权限。", "danger");
  }
}

function swapLanguages() {
  const source = els.sourceLang.value;
  const target = els.targetLang.value;

  if (source === "auto") {
    setStatus("自动检测不能直接交换，已将源语言切换为当前目标语言。");
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
  setStatus("已清空当前内容。");
  persistState();
  renderCounts();
}

function clearHistory() {
  history = [];
  saveHistory();
  renderHistory();
  setStatus("历史记录已清空。", "good");
}

function wireEvents() {
  els.translateBtn.addEventListener("click", translate);
  els.swapBtn.addEventListener("click", swapLanguages);
  els.clearBtn.addEventListener("click", clearAll);
  els.copyBtn.addEventListener("click", copyOutput);
  els.clearHistoryBtn.addEventListener("click", clearHistory);

  els.sourceText.addEventListener("input", () => {
    persistState();
    renderCounts();
  });
  els.sourceLang.addEventListener("change", persistState);
  els.targetLang.addEventListener("change", persistState);

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      translate();
    }
  });
}

function init() {
  populateLanguageSelects();
  restoreState();
  wireEvents();
  renderHistory();
  setOutput("", {});
  setStatus("准备就绪，输入文本后点击翻译。");
  renderCounts();
}

init();
