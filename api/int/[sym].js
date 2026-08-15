const UA = "Mozilla/5.0 (compatible; PSXDesk/1.0)";

export async function GET(request) {
  try {
    const pathName = new URL(request.url).pathname;
    const parts = pathName.split("/").filter(Boolean);
    const sym = encodeURIComponent(parts[parts.length - 1] || "");
    if (!sym) return new Response("missing symbol", { status: 400 });
    const r = await fetch("https://dps.psx.com.pk/timeseries/int/" + sym, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
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
