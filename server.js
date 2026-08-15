const http = require("http");
const fs = require("fs");
const path = require("path");
const { send, liveJson, proxyCached, FETCH_MS } = require("./lib/psx");

const ROOT = __dirname;
const PORT = process.env.PORT || 8765;
const ALLOWED_EXT = new Set([".html", ".js", ".json", ".css", ".png", ".ico"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function safeFile(urlPath) {
  const file =
    urlPath === "/" || urlPath === "/index.html" ? "/index.html" : urlPath;
  const normalized = path.posix.normalize(file).replace(/^(\.\.(\/|$))+/, "/");
  const full = path.resolve(ROOT, "." + normalized);
  const root = path.resolve(ROOT);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return full;
}

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    send(res, 400, "text/plain", "bad request");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "text/plain", "method not allowed");
    return;
  }

  if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.png") {
    const name = url.pathname === "/favicon.png" ? "favicon.png" : "favicon.ico";
    const full = path.join(ROOT, name);
    fs.readFile(full, (err, data) => {
      if (err) {
        send(res, 404, "text/plain", "not found");
        return;
      }
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(200, {
        "Content-Type": name.endsWith(".png") ? "image/png" : "image/x-icon",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(data);
    });
    return;
  }

  if (url.pathname === "/live") {
    liveJson()
      .then((body) => send(res, 200, "application/json", body))
      .catch((e) => send(res, 502, "text/plain", String(e.message)));
    return;
  }

  if (url.pathname.startsWith("/eod/")) {
    const sym = encodeURIComponent(url.pathname.slice(5));
    proxyCached("eod", "https://dps.psx.com.pk/timeseries/eod/" + sym, res, FETCH_MS);
    return;
  }

  if (url.pathname.startsWith("/int/")) {
    const sym = encodeURIComponent(url.pathname.slice(5));
    proxyCached("int", "https://dps.psx.com.pk/timeseries/int/" + sym, res, FETCH_MS);
    return;
  }

  const full = safeFile(url.pathname);
  if (!full) {
    send(res, 403, "text/plain", "forbidden");
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      send(res, 404, "text/plain", "not found");
      return;
    }
    send(res, 200, MIME[path.extname(full).toLowerCase()] || "text/plain", data);
  });
}

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.on("clientError", (err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log("http://127.0.0.1:" + PORT + "/");
  });
}
