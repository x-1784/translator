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