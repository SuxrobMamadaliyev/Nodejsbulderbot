const express = require('express');
const config = require('./config');
const logger = require('./logger');
const { buildWebhookRouter } = require('./webhook');
const { buildApiRouter } = require('./api');

function createServer(masterBot) {
  const app = express();

  app.get('/', (req, res) => {
    res.json({ name: 'Telegram Bot Builder Platform', status: 'running' });
  });

  // UptimeRobot yoki boshqa monitoring xizmatlari uchun yengil endpoint.
  // Bazaga yoki botlarga murojaat qilmaydi — faqat serverning ishlab
  // turganini tasdiqlaydi, shuning uchun tez va arzon javob qaytaradi.
  app.get('/ping', (req, res) => {
    res.status(200).send('pong');
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
  });

  app.use('/webhook', buildWebhookRouter(masterBot));
  app.use('/api', buildApiRouter());

  app.use((req, res) => {
    res.status(404).json({ error: 'Topilmadi' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err: err.message }, 'Express xatoligi');
    res.status(500).json({ error: 'Ichki server xatoligi' });
  });

  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(config.port, () => {
      logger.info({ port: config.port }, 'HTTP server ishga tushdi');
      resolve(server);
    });
  });
}

module.exports = { createServer, startServer };
