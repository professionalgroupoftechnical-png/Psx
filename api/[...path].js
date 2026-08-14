const { handleRequest } = require("../server");

module.exports = (req, res) => {
  const raw = req.url || "/";
  const stripped = raw.replace(/^\/api(?=\/|$)/, "") || "/";
  req.url = stripped.startsWith("/") ? stripped : "/" + stripped;
  return handleRequest(req, res);
};
