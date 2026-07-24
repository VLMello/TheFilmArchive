const express = require('express');
const fs = require('fs/promises');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const stats = await fs.statfs('/data');
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  const usedBytes = totalBytes - stats.bfree * stats.bsize;
  res.json({ totalBytes, usedBytes, freeBytes });
}));

module.exports = router;
