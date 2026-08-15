(function () {
  "use strict";

  const LIVE_MS = 8000;
  const DETAIL_MS = 12000;
  const LERP = 0.16;
  const LERP_EPS = 0.015;

  function defaultViewCount() {
    const w = window.innerWidth;
    if (w < 480) return 12;
    if (w < 768) return 20;
    if (w < 1100) return 32;
    return 50;
  }

  let COMPANIES = [];
  let bySym = new Map();
  let sortMode = "gainers";
  let current = null;
  let chartCache = new Map();
  let viewCount = defaultViewCount();
  let viewStart = 0;
  let rangePct = {};
  let rangeLoadId = 0;
  let rangeTimer = 0;
  let liveMode = true;
  let displayPct = Object.create(null);
  let liveBusy = false;
  let liveGen = 0;
  let chartSeq = 0;
  let overviewHit = [];
  let rowsCacheKey = "";
  let rowsCache = [];
  let animRaf = 0;
  let lastBlinkKey = "";
  let ovSize = { w: 0, h: 0, dpr: 0 };
  let lnSize = { w: 0, h: 0, dpr: 0 };
  let searchTimer = 0;
  let resizeTimer = 0;

  const el = {};
  function $(id) {
    return document.getElementById(id);
  }

  function cacheEls() {
    el.search = $("search");
    el.tradedOnly = $("tradedOnly");
    el.countLabel = $("countLabel");
    el.zoomLabel = $("zoomLabel");
    el.clock = $("clock");
    el.fromDate = $("fromDate");
    el.toDate = $("toDate");
    el.qSym = $("qSym");
    el.qName = $("qName");
    el.qPrice = $("qPrice");
    el.qChg = $("qChg");
    el.msg = $("msg");
    el.overview = $("overviewChart");
    el.price = $("priceChart");
    el.blinkLayer = $("blinkLayer");
    el.tip = $("tip");
    el.overviewBox = $("overviewBox");
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function setDateWindow(fromDate, toDate) {
    const to = toDate || new Date();
    const today = isoDate(new Date());
    const min = isoDate(new Date(new Date().getFullYear() - 6, 0, 1));
    el.toDate.max = today;
    el.fromDate.max = today;
    el.fromDate.min = min;
    el.toDate.min = min;
    el.fromDate.value = isoDate(fromDate);
    el.toDate.value = isoDate(to);
  }

  function setRangeMonths(months) {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - months);
    setDateWindow(from, to);
  }

  function setRangeYears(years) {
    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - years);
    setDateWindow(from, to);
  }

  function setRangeDays(days) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateWindow(from, to);
  }

  function clearPeriodActive() {
    document.querySelectorAll("#periodBar button").forEach((b) => b.classList.remove("active"));
  }

  function applyPeriod() {
    rangePct = {};
    rowsCacheKey = "";
    document.body.classList.toggle("live-on", liveMode);
    drawOverview();
    if (!liveMode) scheduleRangeLoad();
    loadChart();
  }

  function tickClock() {
    if (!el.clock) return;
    const tag = liveMode ? "LIVE  ·  " : "";
    el.clock.textContent =
      tag + new Date().toLocaleTimeString("en-GB", { hour12: false }) + " PKT";
  }

  function fmtPct(n) {
    return (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
  }

  function sortedRows() {
    const q = el.search.value.trim().toUpperCase();
    const tradedOnly = el.tradedOnly.checked;
    const key = [liveMode ? 1 : 0, sortMode, tradedOnly ? 1 : 0, q, liveGen].join("|");
    if (key === rowsCacheKey) return rowsCache;
    const rows = COMPANIES.filter((c) => {
      if (!liveMode && c.d <= 0) return false;
      if (tradedOnly && c.nc) return false;
      if (q && !c.s.includes(q) && !c.nU.includes(q)) return false;
      return true;
    });
    if (sortMode === "az") rows.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    else if (liveMode) rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    else rows.sort((a, b) => b.d - a.d);
    rowsCacheKey = key;
    rowsCache = rows;
    return rows;
  }

  function visibleSlice(rows) {
    const vis = Math.min(viewCount, rows.length);
    const maxStart = Math.max(0, rows.length - vis);
    if (viewStart > maxStart) viewStart = maxStart;
    if (viewStart < 0) viewStart = 0;
    return { vis, view: rows.slice(viewStart, viewStart + vis) };
  }

  function renderList() {
    const rows = sortedRows();
    const { vis } = visibleSlice(rows);
    el.countLabel.textContent = rows.length
      ? viewStart + 1 + "–" + (viewStart + vis) + " of " + rows.length + (liveMode ? " live movers" : " in profit")
      : liveMode
        ? "0 live movers"
        : "0 in profit";
    if (el.zoomLabel) el.zoomLabel.textContent = vis + " / screen";
    drawOverview();
    if (!liveMode) scheduleRangeLoad();
  }

  function setQuote() {
    if (!current) return;
    el.qSym.textContent = current.s;
    el.qName.textContent = current.n + (current.nc ? " (not currently traded)" : "");
    el.qPrice.textContent = current.p == null ? "—" : "₨ " + Number(current.p).toLocaleString("en-PK");
    el.qChg.textContent = fmtPct(current.d) + " today";
    el.qChg.className = "quote-chg " + (current.d >= 0 ? "up-bg" : "dn-bg");
  }

  function parseBody(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {}
    const i = text.indexOf("{");
    const j = text.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(text.slice(i, j + 1));
      } catch (_) {}
    }
    return null;
  }

  async function fetchJSON(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 20000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) return null;
      return parseBody(await res.text());
    } catch (_) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  function pointsFromDps(j) {
    const rows = j && j.data;
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row[1] == null) continue;
      let t = Number(row[0]);
      if (t > 1e12) t = Math.floor(t / 1000);
      out.push({ t, c: Number(row[1]) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  async function loadSeries(sym) {
    const hit = chartCache.get(sym);
    if (hit && hit.length) return hit;
    const pts = pointsFromDps(await fetchJSON("/eod/" + encodeURIComponent(sym)));
    if (chartCache.size > 60) {
      const first = chartCache.keys().next().value;
      chartCache.delete(first);
    }
    chartCache.set(sym, pts);
    return pts;
  }

  function sliceRange(pts) {
    if (!pts.length) return [];
    const fromIso = el.fromDate.value;
    const toIso = el.toDate.value;
    if (!fromIso && !toIso) return pts;
    return pts.filter((p) => {
      const d = isoDate(new Date(p.t * 1000));
      if (fromIso && d < fromIso) return false;
      if (toIso && d > toIso) return false;
      return true;
    });
  }

  function pctOf(c) {
    if (liveMode) return displayPct[c.s] != null ? displayPct[c.s] : c.d;
    if (Object.prototype.hasOwnProperty.call(rangePct, c.s)) return rangePct[c.s];
    return null;
  }

  function retFromPts(pts) {
    const s = sliceRange(pts);
    if (s.length >= 2 && s[0].c) return ((s[s.length - 1].c - s[0].c) / s[0].c) * 100;
    if (s.length === 1) return 0;
    return null;
  }

  function barLabel(v) {
    if (v == null) return "…";
    const n = Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
    return (v > 0 ? "+" : "") + n + "%";
  }

  async function loadVisibleRange() {
    if (liveMode) return;
    const id = ++rangeLoadId;
    const rows = sortedRows();
    const { view } = visibleSlice(rows);
    const missing = view.filter((c) => !Object.prototype.hasOwnProperty.call(rangePct, c.s));
    for (let i = 0; i < missing.length; i += 6) {
      if (id !== rangeLoadId) return;
      const batch = missing.slice(i, i + 6);
      await Promise.all(
        batch.map(async (c) => {
          const pts = await loadSeries(c.s);
          if (id !== rangeLoadId) return;
          const r = retFromPts(pts);
          rangePct[c.s] = r != null ? r : c.d;
        })
      );
      if (id !== rangeLoadId) return;
      drawOverview();
    }
    if (id !== rangeLoadId) return;
    drawOverview();
  }

  function scheduleRangeLoad() {
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(loadVisibleRange, 180);
  }

  function sizeCanvas(canvas, w, h, cache) {
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    if (cache.w !== bw || cache.h !== bh || cache.dpr !== dpr) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      cache.w = bw;
      cache.h = bh;
      cache.dpr = dpr;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function drawLine(pts) {
    const canvas = el.price;
    const parent = canvas.parentElement;
    const w = parent.clientWidth || 640;
    const h = parent.clientHeight || 360;
    const ctx = sizeCanvas(canvas, w, h, lnSize);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 52, r: 16, t: 16, b: 36 };
    let min = pts[0].c;
    let max = pts[0].c;
    for (let i = 1; i < pts.length; i++) {
      const c = pts[i].c;
      if (c < min) min = c;
      if (c > max) max = c;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const last = pts.length - 1;
    const xAt = (i) => pad.l + (i / last) * plotW;
    const yAt = (v) => pad.t + (1 - (v - min) / (max - min)) * plotH;
    const up = pts[last].c >= pts[0].c;
    const stroke = up ? "#3ee0a4" : "#ff6b7a";
    const fillTop = up ? "rgba(62,224,164,0.22)" : "rgba(255,107,122,0.20)";

    ctx.strokeStyle = "rgba(232,197,106,0.16)";
    ctx.lineWidth = 1;
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (g / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText((max - (g / 4) * (max - min)).toFixed(2), pad.l - 8, y + 4);
    }

    const area = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    area.addColorStop(0, fillTop);
    area.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(pts[0].c));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(xAt(i), yAt(pts[i].c));
    ctx.lineTo(xAt(last), pad.t + plotH);
    ctx.lineTo(xAt(0), pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(pts[0].c));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(xAt(i), yAt(pts[i].c));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(xAt(last), yAt(pts[last].c), 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    const ticks = [0, (last / 2) | 0, last];
    for (let t = 0; t < ticks.length; t++) {
      const i = ticks[t];
      const d = new Date(pts[i].t * 1000);
      ctx.fillText(d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), xAt(i), h - 12);
    }
  }

  function selectScrip(sym) {
    const found = bySym.get(sym);
    if (!found) return;
    current = found;
    document.body.classList.add("show-detail");
    drawOverview();
    loadChart();
  }

  function closeDetail() {
    current = null;
    document.body.classList.remove("show-detail");
    drawOverview();
  }

  function drawOverview() {
    const canvas = el.overview;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const rows = sortedRows();
    const w = parent.clientWidth || 640;
    const h = parent.clientHeight || 220;
    const ctx = sizeCanvas(canvas, w, h, ovSize);
    ctx.clearRect(0, 0, w, h);
    overviewHit = [];
    if (!rows.length) {
      if (el.blinkLayer) el.blinkLayer.textContent = "";
      lastBlinkKey = "";
      return;
    }

    const { view } = visibleSlice(rows);
    const compact = w < 768;
    const pad = compact
      ? { l: 36, r: 8, t: 28, b: compact && w < 480 ? 36 : 48 }
      : { l: 48, r: 14, t: 36, b: 54 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const n = view.length;
    const slot = plotW / n;
    const barW = Math.max(compact ? 2.5 : 3, slot * (compact ? 0.5 : 0.42));
    const vals = new Array(n);
    const loaded = [];
    let hasNeg = false;
    for (let i = 0; i < n; i++) {
      const v = pctOf(view[i]);
      vals[i] = v;
      if (v != null) {
        loaded.push(Math.abs(v));
        if (v < -0.4) hasNeg = true;
      }
    }
    loaded.sort((a, b) => a - b);
    let scaleMax = 8;
    if (loaded.length) {
      const p = loaded[Math.min(loaded.length - 1, (loaded.length * 0.72) | 0)];
      scaleMax = Math.min(35, Math.max(6, p * 1.2));
    }
    const baseY = pad.t + plotH;
    const zeroY = hasNeg ? pad.t + plotH * 0.86 : baseY;
    const upH = Math.max(12, zeroY - pad.t);
    const dnH = Math.max(8, baseY - zeroY);
    const yAt = (v) => {
      const x = Math.max(-scaleMax, Math.min(scaleMax, v));
      return x >= 0 ? zeroY - (x / scaleMax) * upH : zeroY + (Math.abs(x) / scaleMax) * dnH;
    };

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = pad.t + (g / 3) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(w - pad.r, zeroY);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = (compact ? "9px" : "10px") + " JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText("+" + scaleMax.toFixed(0) + "%", pad.l - 6, pad.t + 8);
    ctx.fillText("0", pad.l - 6, zeroY);
    if (hasNeg) ctx.fillText("-" + scaleMax.toFixed(0) + "%", pad.l - 6, baseY);

    const radius = Math.min(5, barW / 2);
    const blinks = [];
    const gold = "#ffffff";
    const goldHi = "#ffffff";
    const goldLab = "#ffffff";

    for (let i = 0; i < n; i++) {
      const c = view[i];
      const x = pad.l + i * slot + (slot - barW) / 2;
      const v = vals[i];
      const drawV = v == null ? scaleMax * 0.05 : v;
      const y = yAt(drawV);
      const top = Math.min(y, zeroY);
      const bh = Math.max(4, Math.abs(zeroY - y));
      const selected = current && c.s === current.s;
      const down = v != null && v < 0;
      const topGray = selected ? "rgba(255,255,255,.98)" : down ? "rgba(200,204,210,.95)" : "rgba(245,246,248,.97)";
      const midGray = selected ? "rgba(210,214,220,.94)" : down ? "rgba(150,156,164,.9)" : "rgba(176,182,190,.92)";
      const botGray = selected ? "rgba(120,126,136,.9)" : "rgba(88,94,104,.92)";
      const grad = ctx.createLinearGradient(x, top, x, top + bh);
      grad.addColorStop(0, topGray);
      grad.addColorStop(0.42, midGray);
      grad.addColorStop(1, botGray);
      if (selected) {
        ctx.save();
        ctx.shadowColor = "rgba(255,255,255,.35)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, top, barW, bh, [radius, radius, 3, 3]);
        else ctx.rect(x, top, barW, bh);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, top, barW, bh, [radius, radius, 3, 3]);
        else ctx.rect(x, top, barW, bh);
        ctx.fill();
      }
      const shade = ctx.createLinearGradient(x, top, x + barW, top);
      shade.addColorStop(0, "rgba(255,255,255,.45)");
      shade.addColorStop(0.5, "rgba(255,255,255,.08)");
      shade.addColorStop(1, "rgba(40,44,52,.28)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, top, barW, bh, [radius, radius, 3, 3]);
      else ctx.rect(x, top, barW, bh);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      overviewHit.push({ x: pad.l + i * slot, w: slot, c });
      if (v != null && v > 0) {
        blinks.push({ s: c.s, v, left: x + barW / 2, top: Math.max(8, top - 16) });
      }
      ctx.fillStyle = selected ? goldHi : goldLab;
      ctx.font = "bold " + (compact ? "7px" : "8px") + " JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        barLabel(v),
        x + barW / 2,
        v != null && v < 0 ? Math.min(baseY - 2, top + bh + 10) : Math.max(12, top - 5)
      );
      if (slot >= 12) {
        ctx.save();
        ctx.translate(x + barW / 2, h - 8);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = selected ? goldHi : gold;
        ctx.font = (selected ? "bold " : "") + (compact ? "8px" : "9px") + " JetBrains Mono, monospace";
        ctx.textAlign = "left";
        ctx.fillText(c.s, 0, 3);
        ctx.restore();
      }
    }

    blinks.sort((a, b) => b.v - a.v);
    const topN = [];
    for (let i = 0; i < blinks.length && topN.length < 8; i++) {
      if (blinks[i].v >= 1.5) topN.push(blinks[i]);
    }
    const blinkKey = topN.map((b) => b.s + "@" + b.left.toFixed(0) + "," + b.top.toFixed(0)).join("|");
    if (el.blinkLayer && blinkKey !== lastBlinkKey) {
      lastBlinkKey = blinkKey;
      el.blinkLayer.innerHTML = topN
        .map(
          (b) =>
            '<span class="bar-blink" style="left:' +
            b.left.toFixed(1) +
            "px;top:" +
            b.top.toFixed(1) +
            'px" title="' +
            b.s +
            " already printed " +
            barLabel(b.v) +
            '"></span>'
        )
        .join("");
    }
  }

  function hitOverview(ev) {
    const rect = el.overview.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    for (let i = 0; i < overviewHit.length; i++) {
      const b = overviewHit[i];
      if (x >= b.x && x <= b.x + b.w) return b.c;
    }
    return null;
  }

  function downsample(pts, maxN) {
    if (pts.length <= maxN) return pts;
    const out = new Array(maxN);
    const step = (pts.length - 1) / (maxN - 1);
    for (let i = 0; i < maxN; i++) out[i] = pts[Math.round(i * step)];
    return out;
  }

  async function loadChart() {
    if (!current) return;
    const seq = ++chartSeq;
    const sym = current.s;
    setQuote();
    el.msg.innerHTML = '<div class="hint">Chart load ho raha hai…</div>';
    let pts = [];
    if (liveMode) {
      pts = downsample(pointsFromDps(await fetchJSON("/int/" + encodeURIComponent(sym))), 240);
    } else {
      const all = await loadSeries(sym);
      pts = sliceRange(all);
      if (seq !== chartSeq) return;
      if (pts.length < 2 && all.length >= 2) {
        el.msg.innerHTML =
          '<div class="err">' +
          el.fromDate.value +
          " → " +
          el.toDate.value +
          " mein " +
          sym +
          " ki enough candles nahi. Dates check karo.</div>";
        return;
      }
    }
    if (seq !== chartSeq) return;
    if (pts.length < 2) {
      const fileHint =
        location.protocol === "file:"
          ? " File double-click mat karo — http://127.0.0.1:8765/psx-dashboard.html kholo."
          : " Refresh karke dubara try karo.";
      el.msg.innerHTML = '<div class="err">' + sym + " graph nahi aaya." + fileHint + "</div>";
      const ctx = el.price.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, el.price.width, el.price.height);
      return;
    }
    drawLine(pts);
    const last = pts[pts.length - 1].c;
    const first = pts[0].c;
    const isUp = last >= first;
    const ret = ((last - first) / first) * 100;
    const rangeTxt = liveMode ? "today live ticks" : el.fromDate.value + " → " + el.toDate.value;
    el.msg.innerHTML =
      '<div class="hint">' +
      rangeTxt +
      '  ·  <b>' +
      (isUp ? "UP " : "DOWN ") +
      fmtPct(ret) +
      "</b>  ·  educational view only</div>";
  }

  function onDatesChanged() {
    liveMode = false;
    clearPeriodActive();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(el.fromDate.value) || !/^\d{4}-\d{2}-\d{2}$/.test(el.toDate.value)) return;
    if (el.fromDate.value > el.toDate.value) {
      const tmp = el.fromDate.value;
      el.fromDate.value = el.toDate.value;
      el.toDate.value = tmp;
    }
    applyPeriod();
  }

  function kickAnim() {
    if (animRaf || !liveMode || document.hidden) return;
    const loop = () => {
      animRaf = 0;
      if (!liveMode || document.hidden) return;
      const view = visibleSlice(sortedRows()).view;
      let dirty = false;
      for (let i = 0; i < view.length; i++) {
        const c = view[i];
        const tgt = c.d;
        let cur = displayPct[c.s];
        if (cur == null) {
          displayPct[c.s] = tgt;
          continue;
        }
        const n = cur + (tgt - cur) * LERP;
        if (Math.abs(n - tgt) > LERP_EPS) {
          displayPct[c.s] = n;
          dirty = true;
        } else if (cur !== tgt) {
          displayPct[c.s] = tgt;
          dirty = true;
        }
      }
      if (dirty) {
        drawOverview();
        animRaf = requestAnimationFrame(loop);
      }
    };
    animRaf = requestAnimationFrame(loop);
  }

  async function pollLive() {
    if (liveBusy || document.hidden) return;
    liveBusy = true;
    try {
      const j = await fetchJSON("/live", 12000);
      const rows = j && j.rows;
      if (!Array.isArray(rows) || !rows.length) return;
      const map = Object.create(null);
      for (let i = 0; i < rows.length; i++) map[rows[i].s] = rows[i];
      for (let i = 0; i < COMPANIES.length; i++) {
        const c = COMPANIES[i];
        const r = map[c.s];
        if (!r) continue;
        c.p = r.p;
        c.d = r.d;
        c.nc = !(r.v > 0);
        if (displayPct[c.s] == null) displayPct[c.s] = r.d;
      }
      liveGen++;
      rowsCacheKey = "";
      if (liveMode) {
        renderList();
        if (current) setQuote();
        kickAnim();
      }
    } finally {
      liveBusy = false;
    }
  }

  function bindEvents() {
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderList, 80);
    });
    el.tradedOnly.addEventListener("change", () => {
      rowsCacheKey = "";
      renderList();
    });
    $("sortBtns").addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      document.querySelectorAll("#sortBtns button").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      sortMode = e.target.dataset.sort;
      rowsCacheKey = "";
      renderList();
    });
    $("periodBar").addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      if (!e.target.dataset.months && !e.target.dataset.years && !e.target.dataset.live) return;
      clearPeriodActive();
      e.target.classList.add("active");
      if (e.target.dataset.live) {
        liveMode = true;
        setRangeDays(0);
      } else {
        liveMode = false;
        if (e.target.dataset.months) setRangeMonths(Number(e.target.dataset.months));
        else setRangeYears(Number(e.target.dataset.years));
      }
      applyPeriod();
    });
    el.fromDate.addEventListener("change", onDatesChanged);
    el.toDate.addEventListener("change", onDatesChanged);
    el.overview.addEventListener("mousemove", (ev) => {
      const c = hitOverview(ev);
      if (!c) {
        el.tip.style.display = "none";
        el.overview.style.cursor = "default";
        return;
      }
      el.overview.style.cursor = "pointer";
      const v = pctOf(c);
      el.tip.style.display = "block";
      el.tip.innerHTML =
        "<b>" +
        c.s +
        "</b>  " +
        c.n +
        "<br>" +
        (v == null
          ? "loading range…"
          : fmtPct(v) + "  " + el.fromDate.value + " → " + el.toDate.value + " · already printed, not a buy call");
      const rect = el.overviewBox.getBoundingClientRect();
      el.tip.style.left = Math.min(rect.width - 180, Math.max(8, ev.clientX - rect.left + 12)) + "px";
      el.tip.style.top = Math.max(8, ev.clientY - rect.top - 42) + "px";
    });
    el.overview.addEventListener("mouseleave", () => {
      el.tip.style.display = "none";
    });
    el.overview.addEventListener("click", (ev) => {
      const c = hitOverview(ev);
      if (c) selectScrip(c.s);
    });
    el.overview.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const total = sortedRows().length;
        if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
          const step = Math.max(1, Math.round(viewCount / 4));
          viewStart += ev.deltaY > 0 || ev.deltaX > 0 ? step : -step;
        } else if (ev.deltaY < 0) {
          viewCount = Math.max(10, Math.round(viewCount / 1.35));
        } else {
          viewCount = Math.min(Math.max(total, 10), Math.round(viewCount * 1.35));
        }
        renderList();
      },
      { passive: false }
    );
    $("zoomIn").addEventListener("click", () => {
      viewCount = Math.max(10, Math.round(viewCount / 1.4));
      renderList();
    });
    $("zoomOut").addEventListener("click", () => {
      const total = sortedRows().length;
      viewCount = Math.min(Math.max(total, 10), Math.round(viewCount * 1.4));
      renderList();
    });
    $("panLeft").addEventListener("click", () => {
      viewStart -= viewCount;
      renderList();
    });
    $("panRight").addEventListener("click", () => {
      viewStart += viewCount;
      renderList();
    });
    window.addEventListener("resize", () => {
      ovSize.w = 0;
      lnSize.w = 0;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        drawOverview();
        if (current) loadChart();
      }, 120);
    });
    $("closeDetail").addEventListener("click", closeDetail);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        pollLive();
        kickAnim();
      }
    });
  }

  async function boot() {
    cacheEls();
    try {
      const res = await fetch("/companies.json", { cache: "no-store" });
      COMPANIES = await res.json();
    } catch (_) {
      COMPANIES = [];
    }
    if (!Array.isArray(COMPANIES)) COMPANIES = [];
    for (let i = 0; i < COMPANIES.length; i++) {
      const c = COMPANIES[i];
      c.nU = (c.n || "").toUpperCase();
    }
    bySym = new Map(COMPANIES.map((c) => [c.s, c]));
    bindEvents();
    viewCount = defaultViewCount();
    setInterval(tickClock, 1000);
    tickClock();
    setRangeDays(0);
    document.body.classList.add("live-on");
    renderList();
    pollLive();
    setInterval(pollLive, LIVE_MS);
    setInterval(() => {
      if (liveMode && current && !document.hidden) loadChart();
    }, DETAIL_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
