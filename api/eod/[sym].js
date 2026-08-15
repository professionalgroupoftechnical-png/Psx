const { proxyCached, symbolFromReq, send } = require("../_lib");

module.exports = async function handler(req, res) {
  try {
    const sym = encodeURIComponent(symbolFromReq(req, "eod"));
    if (!sym) {
      send(res, 400, "text/plain", "missing symbol");
      return;
    }
    await proxyCached("eod", "https://dps.psx.com.pk/timeseries/eod/" + sym, res);
  } catch (e) {
    send(res, 502, "text/plain", String(e && e.message ? e.message : e));
  }
};
