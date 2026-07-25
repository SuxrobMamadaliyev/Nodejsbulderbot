const config = require('./config');
const logger = require('./logger');
const { connectDatabase } = require('./database');
const bot = require('./bot');
const { createServer, startServer } = require('./server');
const { deployMasterBot, gracefulStop } = require('./deploy');
const { restartAllSavedBots } = require('./botmanager');
const { startScheduler } = require('./scheduler');

async function bootstrap() {
  if (!config.botToken) {
    logger.error('BOT_TOKEN .env faylida ko\'rsatilmagan. Dastur to\'xtatildi.');
    process.exit(1);
  }

  logger.info('Bot Builder Platform ishga tushmoqda...');

  await connectDatabase();

  const app = createServer(bot);
  await startServer(app);

  await deployMasterBot(bot);

  await restartAllSavedBots();

  startScheduler();

  logger.info('✅ Platforma to\'liq ishga tushdi');

  const shutdown = async (signal) => {
    await gracefulStop(bot, signal);
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Platformani ishga tushirishda halokatli xatolik');
  process.exit(1);
});
