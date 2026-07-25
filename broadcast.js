const { Markup } = require('telegraf');
const { getAllActiveUserIds } = require('./users');
const { incrementDailyStat } = require('./statistics');
const { sleep } = require('./functions');
const logger = require('./logger');

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000;

function parseInlineButtons(raw) {
  // Format: "Matn1 - https://link1 | Matn2 - https://link2\nMatn3 - https://link3"
  if (!raw) return null;
  try {
    const rows = raw
      .split('\n')
      .map((line) =>
        line
          .split('|')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((btn) => {
            const [text, url] = btn.split(' - ').map((s) => s.trim());
            return Markup.button.url(text, url);
          })
      )
      .filter((row) => row.length);
    return rows.length ? Markup.inlineKeyboard(rows) : null;
  } catch (err) {
    return null;
  }
}

async function sendToUser(telegram, userId, payload) {
  const { type, text, fileId, caption, replyMarkup } = payload;
  const extra = { ...(replyMarkup || {}), parse_mode: 'HTML' };

  switch (type) {
    case 'text':
      return telegram.sendMessage(userId, text, extra);
    case 'photo':
      return telegram.sendPhoto(userId, fileId, { caption, ...extra });
    case 'video':
      return telegram.sendVideo(userId, fileId, { caption, ...extra });
    case 'audio':
      return telegram.sendAudio(userId, fileId, { caption, ...extra });
    case 'voice':
      return telegram.sendVoice(userId, fileId, { caption, ...extra });
    case 'animation':
      return telegram.sendAnimation(userId, fileId, { caption, ...extra });
    case 'sticker':
      return telegram.sendSticker(userId, fileId, extra);
    case 'document':
      return telegram.sendDocument(userId, fileId, { caption, ...extra });
    default:
      throw new Error('Noma\'lum broadcast turi: ' + type);
  }
}

/**
 * Extract broadcast payload from a Telegram message the admin sent to the master bot.
 */
function buildPayloadFromMessage(message, buttonsRaw) {
  const replyMarkup = parseInlineButtons(buttonsRaw);

  if (message.text) {
    return { type: 'text', text: message.text, replyMarkup };
  }
  if (message.photo) {
    return { type: 'photo', fileId: message.photo[message.photo.length - 1].file_id, caption: message.caption || '', replyMarkup };
  }
  if (message.video) {
    return { type: 'video', fileId: message.video.file_id, caption: message.caption || '', replyMarkup };
  }
  if (message.audio) {
    return { type: 'audio', fileId: message.audio.file_id, caption: message.caption || '', replyMarkup };
  }
  if (message.voice) {
    return { type: 'voice', fileId: message.voice.file_id, caption: message.caption || '', replyMarkup };
  }
  if (message.animation) {
    return { type: 'animation', fileId: message.animation.file_id, caption: message.caption || '', replyMarkup };
  }
  if (message.sticker) {
    return { type: 'sticker', fileId: message.sticker.file_id, replyMarkup };
  }
  if (message.document) {
    return { type: 'document', fileId: message.document.file_id, caption: message.caption || '', replyMarkup };
  }
  throw new Error('Qo\'llab-quvvatlanmaydigan xabar turi');
}

async function runBroadcast(telegram, payload, { onProgress } = {}) {
  const userIds = await getAllActiveUserIds();
  let sent = 0;
  let failed = 0;

  const batches = [];
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    batches.push(userIds.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.allSettled(batch.map((userId) => sendToUser(telegram, userId, payload)));
    results.forEach((r) => {
      if (r.status === 'fulfilled') sent += 1;
      else failed += 1;
    });
    if (onProgress) onProgress({ sent, failed, total: userIds.length });
    // eslint-disable-next-line no-await-in-loop
    await sleep(BATCH_DELAY_MS);
  }

  await incrementDailyStat('broadcastsSent', 1);
  logger.info({ sent, failed, total: userIds.length }, 'Broadcast yakunlandi');
  return { sent, failed, total: userIds.length };
}

module.exports = {
  parseInlineButtons,
  buildPayloadFromMessage,
  runBroadcast,
  sendToUser,
};
