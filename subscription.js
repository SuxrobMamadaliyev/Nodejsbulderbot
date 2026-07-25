const { Channel } = require('./database');
const logger = require('./logger');

async function addChannel({ scope = 'master', botId = null, chatId, title, username, inviteLink, addedBy }) {
  return Channel.create({ scope, botId, chatId, title, username, inviteLink, addedBy });
}

async function removeChannel(channelId) {
  return Channel.deleteOne({ _id: channelId });
}

async function listChannels({ scope = 'master', botId = null } = {}) {
  const query = { scope };
  if (scope === 'bot') query.botId = botId;
  return Channel.find(query).sort({ createdAt: -1 });
}

async function checkUserSubscription(telegram, telegramUserId, channels) {
  const notSubscribed = [];
  for (const channel of channels) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const member = await telegram.getChatMember(channel.chatId, telegramUserId);
      const allowedStatuses = ['creator', 'administrator', 'member'];
      if (!allowedStatuses.includes(member.status)) {
        notSubscribed.push(channel);
      }
    } catch (err) {
      logger.warn({ err: err.message, channel: channel.chatId }, 'Kanal a\'zoligini tekshirishda xatolik');
      notSubscribed.push(channel);
    }
  }
  return { isSubscribed: notSubscribed.length === 0, notSubscribed };
}

async function resolveChannelChatId(telegram, rawInput) {
  const trimmed = rawInput.trim();
  const chat = await telegram.getChat(trimmed);
  return {
    chatId: String(chat.id),
    title: chat.title || chat.username || trimmed,
    username: chat.username ? `@${chat.username}` : null,
    inviteLink: chat.invite_link || (chat.username ? `https://t.me/${chat.username}` : null),
  };
}

module.exports = {
  addChannel,
  removeChannel,
  listChannels,
  checkUserSubscription,
  resolveChannelChatId,
};
