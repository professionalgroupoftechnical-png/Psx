module.exports = (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Vercel function is working"
  });
};