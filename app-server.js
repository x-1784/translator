const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const TRANSLATION_TIMEOUT_MS = Number(process.env.TRANSLATION_TIMEOUT_MS || 8000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

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

async function translateText({ text, source, target }) {
  try {
    return await translateViaMyMemory({ text, source, target });
  } catch (error) {
    throw new Error(`Translation service unavailable: ${formatFetchError(error)}`);
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && requestUrl.pathname === "/") {
      serveFile(res, path.join(PUBLIC_DIR, "index-fixed.html"));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/public/")) {
      const relative = requestUrl.pathname.replace("/public/", "");
      const safePath = path.normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
      serveFile(res, path.join(PUBLIC_DIR, safePath));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(res, 200, { ok: true, provider: "MyMemory" });
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

          const result = await translateText({ text, source, target });
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
