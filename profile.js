const { Bot } = require('./database');
const { getUserByTelegramId } = require('./users');
const { formatDate } = require('./functions');

async function renderProfile(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return '❌ Profil topilmadi.';

  const [totalBots, activeBots] = await Promise.all([
    Bot.countDocuments({ ownerId: telegramId }),
    Bot.countDocuments({ ownerId: telegramId, status: 'active' }),
  ]);

  return (
    `📊 Profil ma'lumotlari\n\n` +
    `🆔 ID: ${user.telegramId}\n` +
    `👤 Username: ${user.username ? '@' + user.username : 'mavjud emas'}\n` +
    `🤖 Botlar soni: ${totalBots}\n` +
    `🟢 Faol botlar: ${activeBots}\n` +
    `👥 Referallar soni: ${user.referralsCount}\n` +
    `🪙 RWcoin balansi: ${user.rwcoin}\n` +
    `📅 Ro'yxatdan o'tgan sana: ${formatDate(user.createdAt)}`
  );
}

module.exports = { renderProfile };
