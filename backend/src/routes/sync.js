const router = require('express').Router();
const { runSync, getStatus } = require('../sync');

router.post('/', (req, res) => {
  runSync().catch(console.error);
  res.json({ message: 'sync started' });
});

router.get('/status', (req, res) => {
  res.json(getStatus());
});

module.exports = router;
