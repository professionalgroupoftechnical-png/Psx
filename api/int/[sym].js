const { proxyCached, symbolFromReq, send } = require("../../lib/psx");

module.exports = async function handler(req, res) {
  try {
    const sym = encodeURIComponent(symbolFromReq(req, "int"));
    if (!sym) {
      send(res, 400, "text/plain", "missing symbol");
      return;
    }
    await proxyCached("int", "https://dps.psx.com.pk/timeseries/int/" + sym, res);
  } catch (e) {
    send(res, 502, "text/plain", String(e && e.message ? e.message : e));
  }
};
