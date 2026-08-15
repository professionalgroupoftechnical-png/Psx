const { liveJson, send } = require("../lib/psx");

module.exports = async function handler(req, res) {
  try {
    const body = await liveJson();
    send(res, 200, "application/json", body);
  } catch (e) {
    send(res, 502, "text/plain", String(e && e.message ? e.message : e));
  }
};
