const cron = require('node-cron');
const { Bot, Log } = require('./database');
const { runtimeBots, startBot } = require('./botmanager');
const logger = require('./logger');

/**
 * Har 5 daqiqada bazada "active" deb belgilangan, lekin runtime xotirasida
 * ishlamayotgan botlarni aniqlab qayta tiklaydi (masalan server qayta ishga tushganda
 * yoki jarayon vaqtincha uzilib qolganda).
 */
function scheduleBotHealthCheck() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const activeBots = await Bot.find({ status: 'active' });
      for (const botDoc of activeBots) {
        if (!runtimeBots.has(botDoc._id.toString())) {
          logger.warn({ botId: botDoc._id.toString() }, 'Faol deb belgilangan bot ishlamayapti, tiklanmoqda...');
          // eslint-disable-next-line no-await-in-loop
          await startBot(botDoc).catch((err) => {
            logger.error({ err: err.message, botId: botDoc._id.toString() }, 'Botni tiklab bo\'lmadi');
          });
        }
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Bot health-check xatoligi');
    }
  });
}

/**
 * Har kuni yarim tunda 30 kundan eski loglarni tozalaydi.
 */
function scheduleLogCleanup() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await Log.deleteMany({ createdAt: { $lt: cutoff } });
      logger.info({ deleted: result.deletedCount }, 'Eski loglar tozalandi');
    } catch (err) {
      logger.error({ err: err.message }, 'Log tozalashda xatolik');
    }
  });
}

function startScheduler() {
  scheduleBotHealthCheck();
  scheduleLogCleanup();
  logger.info('Rejalashtiruvchi (scheduler) ishga tushdi');
}

module.exports = { startScheduler };
