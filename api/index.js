const { handleRequest } = require("../server");

module.exports = (req, res) => {
  req.url = req.url || "/";
  return handleRequest(req, res);
};