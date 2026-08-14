const { handleRequest } = require("../server");

module.exports = (req, res) => {
  const original =
    req.headers["x-forwarded-uri"] ||
    req.headers["x-invoke-path"] ||
    req.url ||
    "/";

  req.url = original;

  handleRequest(req, res);
};