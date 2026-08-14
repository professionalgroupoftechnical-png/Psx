const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = 8765;
const UA = "Mozilla/5.0 (compatible; PSXDesk/1.0)";
const ALLOWED_EXT = new Set([".html", ".js", ".json", ".css", ".png", ".ico"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res, status, type, body) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function fetchBuffer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": UA, Accept: "application/json,text/html" } },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () =>
          resolve({ status: r.statusCode || 200, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs || 20000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

const cache = {
  eod: new Map(),
  int: new Map(),
};
const TTL = { eod: 10 * 60 * 1000, int: 8 * 1000 };
const MAX_CACHE = { eod: 80, int: 24 };

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > ttl) {
    map.delete(key);
    return null;
  }
  return hit.body;
}

function cacheSet(map, key, body, max) {
  if (map.size >= max) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, { t: Date.now(), body });
}

async function proxyCached(kind, url, res, timeoutMs) {
  const key = url.toUpperCase();
  const cached = cacheGet(cache[kind], key, TTL[kind]);
  if (cached) {
    send(res, 200, "application/json", cached);
    return;
  }
  try {
    const { status, body } = await fetchBuffer(url, timeoutMs);
    if (status >= 200 && status < 300) cacheSet(cache[kind], key, body, MAX_CACHE[kind]);
    send(res, status, "application/json", body);
  } catch (e) {
    const stale = cache[kind].get(key);
    if (stale) send(res, 200, "application/json", stale.body);
    else send(res, e.message === "timeout" ? 504 : 502, "text/plain", String(e.message));
  }
}

function parseWatch(html) {
  const out = [];
  const idx = html.indexOf("tbl__body");
  const body = idx >= 0 ? html.slice(idx) : html;
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(body))) {
    const tr = m[1];
    if (!tr.includes("data-search=")) continue;
    const orders = [];
    const oRe = /data-order="([^"]*)"/g;
    let om;
    while ((om = oRe.exec(tr))) orders.push(om[1]);
    if (orders.length < 9) continue;
    const p = Number(orders[5]);
    const d = Number(orders[7]);
    const v = Number(String(orders[8]).replace(/,/g, ""));
    if (!Number.isFinite(p)) continue;
    out.push({
      s: orders[0],
      p,
      d: Number.isFinite(d) ? d : 0,
      v: Number.isFinite(v) ? v : 0,
    });
  }
  return out;
}

let liveCache = { t: 0, body: null };
let liveInflight = null;

async function liveJson() {
  if (liveCache.body && Date.now() - liveCache.t < 7000) return liveCache.body;
  if (liveInflight) return liveInflight;
  liveInflight = (async () => {
    try {
      const { body } = await fetchBuffer("https://dps.psx.com.pk/market-watch", 25000);
      const rows = parseWatch(body.toString("utf8"));
      const json = JSON.stringify({ status: 1, ts: Date.now(), rows });
      liveCache = { t: Date.now(), body: json };
      return json;
    } catch (e) {
      if (liveCache.body) return liveCache.body;
      throw e;
    } finally {
      liveInflight = null;
    }
  })();
  return liveInflight;
}

function safeFile(urlPath) {
  const file = urlPath === "/" ? "/psx-dashboard.html" : urlPath;
  const normalized = path.posix.normalize(file).replace(/^(\.\.(\/|$))+/, "/");
  const full = path.resolve(ROOT, "." + normalized);
  const root = path.resolve(ROOT);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return full;
}

const server = http.createServer((req, res) => {
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
    proxyCached("eod", "https://dps.psx.com.pk/timeseries/eod/" + sym, res, 20000);
    return;
  }

  if (url.pathname.startsWith("/int/")) {
    const sym = encodeURIComponent(url.pathname.slice(5));
    proxyCached("int", "https://dps.psx.com.pk/timeseries/int/" + sym, res, 25000);
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
});

server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("http://127.0.0.1:" + PORT + "/psx-dashboard.html");
});
