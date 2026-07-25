const { Telegraf } = require('telegraf');
const { Bot } = require('./database');
const { encryptToken, decryptToken, isValidBotToken } = require('./security');
const { registerTemplate } = require('./templates');
const config = require('./config');
const logger = require('./logger');

// runtimeBots: botId(string) -> { instance: Telegraf, doc: BotDocument, mode: 'webhook'|'polling' }
const runtimeBots = new Map();

async function verifyTokenWithTelegram(token) {
  if (!isValidBotToken(token)) {
    return { valid: false, error: 'Token formati noto\'g\'ri' };
  }
  try {
    const tempBot = new Telegraf(token);
    const me = await tempBot.telegram.getMe();
    return { valid: true, me };
  } catch (err) {
    return { valid: false, error: err.description || err.message };
  }
}

async function createBot({ ownerId, token, botName, description, templateType }) {
  const verification = await verifyTokenWithTelegram(token);
  if (!verification.valid) {
    throw new Error(verification.error || 'Token tekshiruvdan o\'tmadi');
  }

  const { encrypted, iv } = encryptToken(token);

  const botDoc = await Bot.create({
    ownerId,
    botToken: encrypted,
    botTokenIv: iv,
    botUsername: verification.me.username,
    botName: botName || verification.me.first_name,
    description: description || '',
    templateType: templateType || 'blank',
    status: 'stopped',
    settings: {},
  });

  logger.info({ botId: botDoc._id.toString(), username: botDoc.botUsername }, 'Yangi bot yaratildi');
  return botDoc;
}

function attachCommonHandlers(instance, botDoc) {
  instance.catch((err, ctx) => {
    logger.error({ err: err.message, botId: botDoc._id.toString() }, 'Child bot xatoligi');
  });

  instance.use(async (ctx, next) => {
    try {
      await Bot.updateOne({ _id: botDoc._id }, { $inc: { 'stats.totalMessages': 1 } });
    } catch (err) {
      // jim tarzda o'tkazib yuborish
    }
    return next();
  });
}

async function buildInstance(botDoc) {
  const token = decryptToken(botDoc.botToken, botDoc.botTokenIv);
  const instance = new Telegraf(token);
  attachCommonHandlers(instance, botDoc);
  registerTemplate(botDoc.templateType, instance, botDoc);
  return instance;
}

async function startBot(botId) {
  const botDoc = typeof botId === 'string' ? await Bot.findById(botId) : botId;
  if (!botDoc) throw new Error('Bot topilmadi');

  const existing = runtimeBots.get(botDoc._id.toString());
  if (existing) {
    return existing;
  }

  const instance = await buildInstance(botDoc);

  if (config.useWebhook && config.baseUrl) {
    const path = `/webhook/bot/${botDoc._id.toString()}`;
    await instance.telegram.setWebhook(`${config.baseUrl}${path}`);
    botDoc.webhookSet = true;
    runtimeBots.set(botDoc._id.toString(), { instance, doc: botDoc, mode: 'webhook', path });
  } else {
    await instance.telegram.deleteWebhook().catch(() => {});
    instance.launch().catch((err) => {
      logger.error({ err: err.message, botId: botDoc._id.toString() }, 'Botni polling rejimida ishga tushirishda xatolik');
    });
    runtimeBots.set(botDoc._id.toString(), { instance, doc: botDoc, mode: 'polling' });
  }

  botDoc.status = 'active';
  await botDoc.save();

  logger.info({ botId: botDoc._id.toString(), username: botDoc.botUsername }, 'Bot ishga tushirildi');
  return runtimeBots.get(botDoc._id.toString());
}

async function stopBot(botId) {
  const idStr = typeof botId === 'string' ? botId : botId._id.toString();
  const running = runtimeBots.get(idStr);
  if (running) {
    if (running.mode === 'polling') {
      running.instance.stop('manual_stop');
    } else {
      await running.instance.telegram.deleteWebhook().catch(() => {});
    }
    runtimeBots.delete(idStr);
  }
  await Bot.updateOne({ _id: idStr }, { $set: { status: 'stopped', webhookSet: false } });
  logger.info({ botId: idStr }, 'Bot to\'xtatildi');
  return true;
}

async function restartBot(botId) {
  const idStr = typeof botId === 'string' ? botId : botId._id.toString();
  await stopBot(idStr);
  const botDoc = await Bot.findById(idStr);
  return startBot(botDoc);
}

async function deleteBot(botId) {
  const idStr = typeof botId === 'string' ? botId : botId._id.toString();
  await stopBot(idStr).catch(() => {});
  await Bot.deleteOne({ _id: idStr });
  logger.info({ botId: idStr }, 'Bot butunlay o\'chirildi');
  return true;
}

async function setWebhook(botId) {
  const botDoc = typeof botId === 'string' ? await Bot.findById(botId) : botId;
  const running = runtimeBots.get(botDoc._id.toString());
  if (!running) throw new Error('Bot ishga tushirilmagan');
  const path = `/webhook/bot/${botDoc._id.toString()}`;
  await running.instance.telegram.setWebhook(`${config.baseUrl}${path}`);
  botDoc.webhookSet = true;
  await botDoc.save();
  return path;
}

async function deleteWebhook(botId) {
  const botDoc = typeof botId === 'string' ? await Bot.findById(botId) : botId;
  const token = decryptToken(botDoc.botToken, botDoc.botTokenIv);
  const tempBot = new Telegraf(token);
  await tempBot.telegram.deleteWebhook();
  botDoc.webhookSet = false;
  await botDoc.save();
  return true;
}

async function getBotInfo(botId) {
  const botDoc = typeof botId === 'string' ? await Bot.findById(botId) : botId;
  if (!botDoc) throw new Error('Bot topilmadi');
  const token = decryptToken(botDoc.botToken, botDoc.botTokenIv);
  const tempBot = new Telegraf(token);
  const me = await tempBot.telegram.getMe();
  return { doc: botDoc, me, isRunning: runtimeBots.has(botDoc._id.toString()) };
}

function getRuntimeInstance(botId) {
  return runtimeBots.get(String(botId));
}

async function restartAllSavedBots() {
  const activeBots = await Bot.find({ status: 'active' });
  logger.info({ count: activeBots.length }, 'Saqlangan faol botlar tiklanmoqda...');
  let started = 0;
  for (const botDoc of activeBots) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await startBot(botDoc);
      started += 1;
    } catch (err) {
      logger.error({ err: err.message, botId: botDoc._id.toString() }, 'Botni tiklashda xatolik');
      botDoc.status = 'error';
      // eslint-disable-next-line no-await-in-loop
      await botDoc.save();
    }
  }
  logger.info({ started }, 'Botlarni tiklash yakunlandi');
  return started;
}

async function handleWebhookUpdate(botId, update) {
  const running = runtimeBots.get(String(botId));
  if (!running) return false;
  await running.instance.handleUpdate(update);
  return true;
}

module.exports = {
  verifyTokenWithTelegram,
  createBot,
  startBot,
  stopBot,
  restartBot,
  deleteBot,
  setWebhook,
  deleteWebhook,
  getBotInfo,
  getRuntimeInstance,
  restartAllSavedBots,
  handleWebhookUpdate,
  runtimeBots,
};
