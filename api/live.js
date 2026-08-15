const UA = "Mozilla/5.0 (compatible; PSXDesk/1.0)";

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

export async function GET() {
  try {
    const r = await fetch("https://dps.psx.com.pk/market-watch", {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    const html = await r.text();
    const rows = parseWatch(html);
    return new Response(JSON.stringify({ status: 1, ts: Date.now(), rows }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(String(e && e.message ? e.message : e), {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
