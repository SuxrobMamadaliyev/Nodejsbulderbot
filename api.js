const express = require('express');
const { getOverallStatistics } = require('./statistics');
const { Bot, User } = require('./database');
const logger = require('./logger');

function buildApiRouter() {
  const router = express.Router();
  router.use(express.json());

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  router.get('/stats', async (req, res) => {
    try {
      const stats = await getOverallStatistics();
      res.json(stats);
    } catch (err) {
      logger.error({ err: err.message }, 'API /stats xatoligi');
      res.status(500).json({ error: 'Ichki server xatoligi' });
    }
  });

  router.get('/bots/count', async (req, res) => {
    const total = await Bot.countDocuments();
    const active = await Bot.countDocuments({ status: 'active' });
    res.json({ total, active });
  });

  router.get('/users/count', async (req, res) => {
    const total = await User.countDocuments();
    res.json({ total });
  });

  return router;
}

module.exports = { buildApiRouter };
