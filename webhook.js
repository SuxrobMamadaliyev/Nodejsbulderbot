const express = require('express');
const config = require('./config');
const logger = require('./logger');
const { handleWebhookUpdate } = require('./botmanager');

function buildWebhookRouter(masterBot) {
  const router = express.Router();

  router.use(express.json({ limit: '2mb' }));

  // Master bot webhook: /webhook/master/<secret>
  router.post(`/master/${config.webhookSecret}`, async (req, res) => {
    try {
      await masterBot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (err) {
      logger.error({ err: err.message }, 'Master bot webhook xatoligi');
      res.sendStatus(200);
    }
  });

  // Child bot webhook: /webhook/bot/<botId>
  router.post('/bot/:botId', async (req, res) => {
    try {
      const handled = await handleWebhookUpdate(req.params.botId, req.body);
      if (!handled) {
        logger.warn({ botId: req.params.botId }, 'Ishlamayotgan botga webhook keldi');
      }
      res.sendStatus(200);
    } catch (err) {
      logger.error({ err: err.message, botId: req.params.botId }, 'Child bot webhook xatoligi');
      res.sendStatus(200);
    }
  });

  return router;
}

module.exports = { buildWebhookRouter };
