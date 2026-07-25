const config = require('./config');
const logger = require('./logger');

/**
 * Master botni ishga tushirish rejimini aniqlaydi va kerak bo'lsa webhookni o'rnatadi.
 * USE_WEBHOOK=true va BASE_URL berilgan bo'lsa webhook rejimida,
 * aks holda polling rejimida ishga tushadi (masalan lokal rivojlantirish uchun).
 */
async function deployMasterBot(bot) {
  if (config.useWebhook) {
    if (!config.baseUrl) {
      throw new Error('USE_WEBHOOK=true bo\'lganda BASE_URL majburiy');
    }
    const webhookPath = `/webhook/master/${config.webhookSecret}`;
    const fullUrl = `${config.baseUrl}${webhookPath}`;
    await bot.telegram.setWebhook(fullUrl);
    logger.info({ url: fullUrl }, 'Master bot webhook rejimida ishga tushdi');
    return { mode: 'webhook', path: webhookPath };
  }

  await bot.telegram.deleteWebhook().catch(() => {});
  await bot.launch();
  logger.info('Master bot polling rejimida ishga tushdi');
  return { mode: 'polling' };
}

async function gracefulStop(bot, signal) {
  logger.info({ signal }, 'Server to\'xtatilmoqda...');
  try {
    if (!config.useWebhook) {
      bot.stop(signal);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Botni to\'xtatishda xatolik');
  }
}

module.exports = { deployMasterBot, gracefulStop };
