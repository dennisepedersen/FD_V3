const express = require("express");

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

router.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

module.exports = router;
