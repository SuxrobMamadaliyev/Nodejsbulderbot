const cron = require('node-cron');
const config = require('./config');
const { Bot, Log } = require('./database');
const { runtimeBots, startBot } = require('./botmanager');
const { closeExpiredAuctions, getActiveAuctions, renderChannelAuctionText } = require('./auction');
const { channelAuctionInline } = require('./buttons');
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

/**
 * Har daqiqada muddati tugagan RWcoin auksionlarini yopadi va
 * g'olibga xabar yuborib, RWcoinlarini hisobiga qo'shadi.
 */
function scheduleAuctionClosing() {
  cron.schedule('* * * * *', async () => {
    try {
      // Aylanma require'dan qochish uchun bot.js shu yerda, kerak bo'lganda yuklanadi
      const bot = require('./bot');
      const closedCount = await closeExpiredAuctions(async (winnerId, auction, payout) => {
        await bot.telegram.sendMessage(
          winnerId,
          `🏆 Tabriklaymiz! "${auction.title}" auksionida g'olib bo'ldingiz!\n\n` +
            `💰 Hisobingizga ${payout} RWcoin qo'shildi (stavka + bonus).`
        );
        if (auction.channelMessageId && config.auctionChannelId) {
          await bot.telegram
            .editMessageText(
              config.auctionChannelId,
              auction.channelMessageId,
              undefined,
              renderChannelAuctionText(auction, { finished: true })
            )
            .catch(() => {});
        }
      });
      if (closedCount) {
        logger.info(`${closedCount} ta auksion yopildi`);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Auksionlarni yopishda xatolik');
    }
  });
}

/**
 * Kanalga e'lon qilingan faol auksionlarning "Qolgan vaqt" hisoblagichini
 * har daqiqada yangilab turadi, shunda foydalanuvchilar jonli countdown'ni
 * ko'radi (rasmdagi namunaga o'xshab).
 */
function scheduleAuctionChannelRefresh() {
  cron.schedule('* * * * *', async () => {
    if (!config.auctionChannelId) return;
    try {
      const bot = require('./bot');
      const activeAuctions = await getActiveAuctions();
      const me = await bot.telegram.getMe();
      for (const auction of activeAuctions) {
        if (!auction.channelMessageId) continue;
        // eslint-disable-next-line no-await-in-loop
        await bot.telegram
          .editMessageText(
            config.auctionChannelId,
            auction.channelMessageId,
            undefined,
            renderChannelAuctionText(auction),
            channelAuctionInline(auction, me.username)
          )
          .catch(() => {});
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Auksion kanal xabarini yangilashda xatolik');
    }
  });
}

function startScheduler() {
  scheduleBotHealthCheck();
  scheduleLogCleanup();
  scheduleAuctionClosing();
  scheduleAuctionChannelRefresh();
  logger.info('Rejalashtiruvchi (scheduler) ishga tushdi');
}

module.exports = { startScheduler };
