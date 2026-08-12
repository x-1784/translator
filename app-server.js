const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TRANSLATION_TIMEOUT_MS = Number(process.env.TRANSLATION_TIMEOUT_MS || 8000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const CACHE_DIR = process.env.TRANSLATION_CACHE_DIR || path.join(ROOT, ".cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const ENGINES = {
  mymemory: { label: "MyMemory", handler: translateViaMyMemory },
  google: { label: "Google Translate", handler: translateViaGoogleFree },
};

const ENGINE_ORDER = ["mymemory", "google"];

try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (error) {
  console.warn("Unable to create cache directory:", error.message);
}

function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function normalizeLang(lang) {
  return String(lang || "auto").trim();
}

function guessSourceLanguage(text) {
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh-CN";
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u0600-\u06ff]/u.test(text)) return "ar";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[\u0e00-\u0e7f]/u.test(text)) return "th";
  return "en";
}

function getCacheKey(text, source, target) {
  return crypto.createHash("md5").update(`${text}|${source}|${target}`).digest("hex");
}

function getCacheFilePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

function getCache(text, source, target) {
  try {
    const filePath = getCacheFilePath(getCacheKey(text, source, target));
    if (!fs.existsSync(filePath)) return null;

    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") return null;

    if (Date.now() - Number(raw.cachedAt || 0) > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }

    return raw.payload || null;
  } catch (error) {
    return null;
  }
}

function setCache(text, source, target, payload) {
  try {
    const filePath = getCacheFilePath(getCacheKey(text, source, target));
    fs.writeFileSync(filePath, JSON.stringify({ cachedAt: Date.now(), payload }), "utf8");
  } catch (error) {
    console.warn("Unable to write cache entry:", error.message);
  }
}

function cleanOldCache() {
  try {
    const entries = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    let removed = 0;

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(CACHE_DIR, entry);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > CACHE_TTL_MS) {
          fs.unlinkSync(filePath);
          removed += 1;
        }
      } catch (error) {
        // ignore individual entry failures
      }
    }

    if (removed > 0) {
      console.log(`Cache cleanup removed ${removed} stale entries`);
    }
  } catch (error) {
    // cache directory may not exist yet
  }
}

function formatFetchError(error) {
  if (!error || typeof error !== "object") {
    return "Unknown error";
  }

  const parts = [];
  if (typeof error.message === "string" && error.message) {
    parts.push(error.message);
  }
  if (error.cause && typeof error.cause === "object") {
    if (typeof error.cause.code === "string" && error.cause.code) {
      parts.push(error.cause.code);
    }
    if (typeof error.cause.message === "string" && error.cause.message) {
      parts.push(error.cause.message);
    }
  }

  return parts.join(" | ") || "Unknown error";
}

async function requestJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const detail =
      body && typeof body === "object" && typeof body.responseDetails === "string"
        ? body.responseDetails
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return body;
}

async function translateViaMyMemory({ text, source, target }) {
  const effectiveSource = source === "auto" ? guessSourceLanguage(text) : source;
  const query = new URL("https://api.mymemory.translated.net/get");
  query.searchParams.set("q", text);
  query.searchParams.set("langpair", `${effectiveSource}|${target}`);

  const body = await requestJson(query);
  const translatedText =
    body && body.responseData && typeof body.responseData.translatedText === "string"
      ? body.responseData.translatedText.trim()
      : "";

  if (!translatedText) {
    throw new Error("No translation was returned");
  }

  return {
    translatedText,
    detectedSource: effectiveSource,
    provider: "MyMemory",
  };
}

async function translateViaGoogleFree({ text, source, target }) {
  const query = new URL("https://translate.googleapis.com/translate_a/single");
  query.searchParams.set("client", "gtx");
  query.searchParams.set("sl", source === "auto" ? "auto" : source);
  query.searchParams.set("tl", target);
  query.searchParams.set("dt", "t");
  query.searchParams.set("q", text);

  const response = await fetch(query, {
    signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw new Error("Unexpected response shape");
  }

  const translatedText = body[0]
    .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
    .join("")
    .trim();

  if (!translatedText) {
    throw new Error("No translation was returned");
  }

  const detectedSource =
    typeof body[2] === "string" && body[2] ? body[2] : source === "auto" ? guessSourceLanguage(text) : source;

  return {
    translatedText,
    detectedSource,
    provider: "Google Translate",
  };
}

// ==================== 有道词典查询（单词多释义） ====================
// 免费公开接口，无 key。返回 ec(英→中) / ce(中→英) / 词形 / 词组 / 例句 / 网络释义。
// 解析全部防御性取值，任何字段缺失都降级；全空则抛错，由调用方回退普通翻译。
function parseDictTextLines(trs) {
  if (!Array.isArray(trs)) return [];
  const lines = [];
  for (const t of trs) {
    const l = t?.tr?.[0]?.l;
    if (!l) continue;

    // ec(英→中) 的 i 是字符串数组（形如 "n. 财政部；..."）；
    // ce(中→英) 的 i 是 "" + {#text:"warehouse"} 对象，pos 单独在 l.pos，#tran 是中文释义
    const pos = typeof l.pos === "string" && l.pos.trim() ? `${l.pos.trim()} ` : "";
    const items = Array.isArray(l.i) ? l.i : [l.i].filter(Boolean);
    const parts = [];

    for (const entry of items) {
      if (typeof entry === "string") {
        const s = entry.trim();
        if (s) parts.push(s);
      } else if (entry && typeof entry === "object" && typeof entry["#text"] === "string") {
        const s = entry["#text"].trim();
        if (s) parts.push(s);
      }
    }

    // 无英文词条时，用 #tran 兜底
    if (parts.length === 0 && typeof l["#tran"] === "string" && l["#tran"].trim()) {
      parts.push(l["#tran"].trim());
    }

    if (parts.length) lines.push(pos + parts.join("；"));
  }
  return lines;
}

async function lookupYoudaoDict(word) {
  const query = new URL("https://dict.youdao.com/jsonapi");
  query.searchParams.set("q", word);

  const body = await requestJson(query);

  const ecWord = body?.ec?.word?.[0];
  const ceWord = body?.ce?.word?.[0];

  const phonetic = ecWord?.phone || ceWord?.phone || "";
  const ecLines = parseDictTextLines(ecWord?.trs);
  const ceLines = parseDictTextLines(ceWord?.trs);

  // 中→英：结构化「英文词 + 中文释义」条目（汉英词典），用于目标语言为英文时展示
  const ceEntries = [];
  for (const t of Array.isArray(ceWord?.trs) ? ceWord.trs : []) {
    const l = t?.tr?.[0]?.l;
    if (!l) continue;
    const pos = typeof l.pos === "string" ? l.pos.trim() : "";
    const words = (Array.isArray(l.i) ? l.i : [])
      .map((x) => (typeof x === "string" ? x : x?.["#text"]))
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    const meanings = typeof l["#tran"] === "string" ? l["#tran"].trim() : "";
    if (words.length) ceEntries.push({ pos, words, meanings });
  }

  const forms = Array.isArray(ecWord?.wfs)
    ? ecWord.wfs
        .map((w) => ({ name: w?.wf?.name || "", value: w?.wf?.value || "" }))
        .filter((f) => f.value)
    : [];

  const phrases = Array.isArray(body?.phrs)
    ? body.phrs.map((p) => p?.phr?.headword || "").filter(Boolean).slice(0, 8)
    : [];

  // sentence-eng 是带 <b> 高亮的源语言句子（字段名有误导性），sentence-translation 才是目标语言译文
  const sentencePairs = body?.blng_sents_part?.["sentence-pair"];
  const examples = Array.isArray(sentencePairs)
    ? sentencePairs
        .slice(0, 5)
        .map((p) => ({
          sentence: p?.["sentence-eng"] || p?.sentence || "",
          translation: p?.["sentence-translation"] || "",
        }))
        .filter((e) => e.sentence)
    : [];

  const webTransArr = body?.web_trans?.["web-translation"];
  const webTrans = Array.isArray(webTransArr)
    ? webTransArr
        .slice(0, 5)
        .map((w) => ({
          key: w?.key || "",
          translations: Array.isArray(w?.trans) ? w.trans.map((t) => t?.tgt || "").filter(Boolean) : [],
        }))
        .filter((w) => w.key || w.translations.length)
    : [];

  if (ecLines.length === 0 && ceLines.length === 0 && examples.length === 0 && webTrans.length === 0) {
    throw new Error(`No dictionary entry found for "${word}"`);
  }

  return { word, phonetic, ecLines, ceLines, ceEntries, forms, phrases, examples, webTrans };
}

// ==================== AI OCR（智谱 GLM 视觉，识别精度远高于 Tesseract） ====================
// Key 优先级：环境变量 ZHIPU_API_KEY → ZHIPU_KEY_FILE（桌面版注入 userData）→ 项目根目录 zhipu-key.txt
function getZhipuKey() {
  const envKey = String(process.env.ZHIPU_API_KEY || "").trim();
  if (envKey) return envKey;

  const candidates = [
    process.env.ZHIPU_KEY_FILE,
    path.join(ROOT, "zhipu-key.txt"),
  ];
  for (const file of candidates) {
    if (!file) continue;
    try {
      if (fs.existsSync(file)) {
        const key = fs.readFileSync(file, "utf8").trim();
        if (key) return key;
      }
    } catch (error) {
      // 忽略单个文件读取失败
    }
  }
  return "";
}

const OCR_PROMPT =
  "请提取这张图片中的所有文字，原样输出。只输出识别出的文字内容，不要翻译，不要添加任何解释或格式符号。";

async function ocrViaGLM(dataUrl) {
  const key = getZhipuKey();
  if (!key) {
    throw new Error("未配置智谱 API Key（AI 精准识别）");
  }

  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl || "");
  if (!match) {
    throw new Error("无效的图片数据");
  }
  const [, mime, b64] = match;

  const payload = {
    model: String(process.env.ZHIPU_MODEL || "glm-4v-flash").trim() || "glm-4v-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  };

  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`智谱 API 错误 (HTTP ${response.status})${detail ? ": " + detail.slice(0, 200) : ""}`);
  }

  const result = await response.json();
  const text = result?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("智谱 API 响应格式异常");
  }
  return text.trim();
}

async function translateText({ text, source, target, engine = 'auto' }) {
  const cached = getCache(text, source, target);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const failures = [];

  // 如果指定了引擎（非 auto），只尝试该引擎；否则按默认顺序轮询
  const order = (engine !== 'auto' && ENGINES[engine])
    ? [engine, ...ENGINE_ORDER.filter(k => k !== engine)]
    : ENGINE_ORDER;

  for (const engineKey of order) {
    const eng = ENGINES[engineKey];
    if (!eng) continue;

    try {
      const result = await eng.handler({ text, source, target });
      setCache(text, source, target, result);
      return { ...result, fromCache: false };
    } catch (error) {
      const detail = formatFetchError(error);
      failures.push(`${eng.label}: ${detail}`);
      console.warn(`Engine ${eng.label} failed, trying next: ${detail}`);
    }
  }

  throw new Error(`Translation service unavailable: ${failures.join(" ; ")}`);
}

function createServer() {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && requestUrl.pathname === "/") {
      serveFile(res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/public/")) {
      const relative = requestUrl.pathname.replace("/public/", "");
      const safePath = path.normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
      serveFile(res, path.join(PUBLIC_DIR, safePath));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(res, 200, { ok: true, provider: "MyMemory", engines: ENGINE_ORDER });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/translate") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) {
          req.destroy();
        }
      });

      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const text = String(parsed.text || "").trim();
          const source = normalizeLang(parsed.source);
          const target = normalizeLang(parsed.target);

          if (!text) {
            sendJson(res, 400, { error: "Please enter text to translate." });
            return;
          }

          if (!target || target === "auto") {
            sendJson(res, 400, { error: "Please choose a target language." });
            return;
          }

          const result = await translateText({ text, source, target, engine: parsed.engine || 'auto' });
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Translation failed.",
          });
        }
      });

      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/dictionary") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) {
          req.destroy();
        }
      });

      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const word = String(parsed.word || "").trim();

          if (!word) {
            sendJson(res, 400, { error: "Please enter a word to look up." });
            return;
          }

          // 复用翻译缓存，source/target 用 "dict" 哨兵避免与真实语言码冲突
          const cached = getCache(word, "dict", "dict");
          if (cached) {
            sendJson(res, 200, { ...cached, provider: "有道词典", fromCache: true });
            return;
          }

          const result = await lookupYoudaoDict(word);
          setCache(word, "dict", "dict", result);
          sendJson(res, 200, { ...result, provider: "有道词典", fromCache: false });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Dictionary lookup failed.",
          });
        }
      });

      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/ocr/status") {
      sendJson(res, 200, {
        configured: !!getZhipuKey(),
        model: String(process.env.ZHIPU_MODEL || "glm-4v-flash").trim() || "glm-4v-flash",
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ocr") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 10_000_000) {
          req.destroy();
        }
      });

      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const image = String(parsed.image || "");

          if (!image) {
            sendJson(res, 400, { error: "缺少图片数据" });
            return;
          }

          const text = await ocrViaGLM(image);
          sendJson(res, 200, { text });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "OCR 识别失败",
          });
        }
      });

      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
}

function startServer(preferredPort = 3000) {
  const server = createServer();
  cleanOldCache();

  return new Promise((resolve, reject) => {
    const listen = (port) => {
      const onError = (error) => {
        server.off("error", onError);
        if (error && error.code === "EADDRINUSE") {
          listen(port + 1);
          return;
        }

        reject(error);
      };

      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        const address = server.address();
        const activePort = typeof address === "object" && address ? address.port : port;
        resolve({
          server,
          port: activePort,
          url: `http://127.0.0.1:${activePort}`,
          close: () =>
            new Promise((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) {
                  closeReject(error);
                  return;
                }
                closeResolve();
              });
            }),
        });
      });
    };

    listen(preferredPort);
  });
}

module.exports = {
  startServer,
};