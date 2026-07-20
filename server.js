const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = Number(process.env.PORT || 3000);
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

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
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
  return String(lang || "auto").trim().toLowerCase();
}

function extractTranslation(payload) {
  if (!Array.isArray(payload)) {
    return "";
  }

  return payload
    .flatMap((segment) => (Array.isArray(segment) ? segment : []))
    .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
    .filter(Boolean)
    .join("")
    .trim();
}

async function translateText({ text, source, target }) {
  const query = new URL("https://translate.googleapis.com/translate_a/single");
  query.searchParams.set("client", "gtx");
  query.searchParams.set("sl", source);
  query.searchParams.set("tl", target);
  query.searchParams.set("dt", "t");
  query.searchParams.set("q", text);

  const response = await fetch(query, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Translation service returned ${response.status}`);
  }

  const data = await response.json();
  const translatedText = extractTranslation(data[0]);
  const detectedSource = Array.isArray(data) && typeof data[2] === "string" ? data[2] : source;

  if (!translatedText) {
    throw new Error("No translation was returned");
  }

  return {
    translatedText,
    detectedSource,
  };
}

const server = http.createServer(async (req, res) => {
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
          send(res, 400, { error: "请输入要翻译的文本。" });
          return;
        }

        if (!target || target === "auto") {
          send(res, 400, { error: "请选择目标语言。" });
          return;
        }

        const result = await translateText({ text, source, target });
        send(res, 200, {
          translatedText: result.translatedText,
          detectedSource: result.detectedSource,
        });
      } catch (error) {
        send(res, 500, {
          error: error instanceof Error ? error.message : "翻译失败。",
        });
      }
    });

    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

function listenWithFallback(preferredPort) {
  server.once("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      const nextPort = preferredPort + 1;
      console.warn(`Port ${preferredPort} is busy. Trying http://localhost:${nextPort} instead.`);
      listenWithFallback(nextPort);
      return;
    }

    console.error("Failed to start translator app:", error);
    process.exit(1);
  });

  server.listen(preferredPort, () => {
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : preferredPort;
    console.log(`Translator app running at http://localhost:${activePort}`);
  });
}

listenWithFallback(DEFAULT_PORT);
