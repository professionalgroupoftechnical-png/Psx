const https = require("https");

const UA = "Mozilla/5.0 (compatible; PSXDesk/1.0)";
const FETCH_MS = process.env.VERCEL ? 8000 : 25000;

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
      const { body } = await fetchBuffer("https://dps.psx.com.pk/market-watch", FETCH_MS);
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

async function proxyCached(kind, url, res, timeoutMs) {
  const key = url.toUpperCase();
  const cached = cacheGet(cache[kind], key, TTL[kind]);
  if (cached) {
    send(res, 200, "application/json", cached);
    return;
  }
  try {
    const { status, body } = await fetchBuffer(url, timeoutMs || FETCH_MS);
    if (status >= 200 && status < 300) cacheSet(cache[kind], key, body, MAX_CACHE[kind]);
    send(res, status, "application/json", body);
  } catch (e) {
    const stale = cache[kind].get(key);
    if (stale) send(res, 200, "application/json", stale.body);
    else send(res, e.message === "timeout" ? 504 : 502, "text/plain", String(e.message));
  }
}

function symbolFromReq(req, prefix) {
  const q = req.query && (req.query.sym || req.query.path);
  if (q) return String(Array.isArray(q) ? q[0] : q);
  try {
    const pathName = new URL(req.url, "http://127.0.0.1").pathname;
    const parts = pathName.split("/").filter(Boolean);
    const idx = parts.lastIndexOf(prefix);
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
    return decodeURIComponent(parts[parts.length - 1] || "");
  } catch {
    return "";
  }
}

module.exports = {
  FETCH_MS,
  send,
  liveJson,
  proxyCached,
  symbolFromReq,
};
