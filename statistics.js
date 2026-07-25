const { User, Bot, Referral, Statistics } = require('./database');
const { todayKey } = require('./functions');

async function incrementDailyStat(field, amount = 1) {
  const date = todayKey();
  await Statistics.updateOne({ date }, { $inc: { [field]: amount } }, { upsert: true });
}

async function getOverallStatistics() {
  const [totalUsers, totalBots, activeBots, totalReferrals, blockedUsers] = await Promise.all([
    User.countDocuments(),
    Bot.countDocuments(),
    Bot.countDocuments({ status: 'active' }),
    Referral.countDocuments(),
    User.countDocuments({ isBlocked: true }),
  ]);

  const today = await Statistics.findOne({ date: todayKey() });

  return {
    totalUsers,
    totalBots,
    activeBots,
    stoppedBots: totalBots - activeBots,
    totalReferrals,
    blockedUsers,
    today: {
      newUsers: today?.newUsers || 0,
      newBots: today?.newBots || 0,
      newReferrals: today?.newReferrals || 0,
      broadcastsSent: today?.broadcastsSent || 0,
    },
  };
}

async function getStatisticsRange(days = 7) {
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dates.push(key);
  }
  const records = await Statistics.find({ date: { $in: dates } });
  const map = new Map(records.map((r) => [r.date, r]));
  return dates.map((date) => ({
    date,
    newUsers: map.get(date)?.newUsers || 0,
    newBots: map.get(date)?.newBots || 0,
    newReferrals: map.get(date)?.newReferrals || 0,
  }));
}

function formatOverallStatistics(stats) {
  return (
    `📊 Umumiy statistika\n\n` +
    `👥 Foydalanuvchilar: ${stats.totalUsers}\n` +
    `🚫 Bloklangan: ${stats.blockedUsers}\n` +
    `🤖 Botlar (jami): ${stats.totalBots}\n` +
    `🟢 Faol botlar: ${stats.activeBots}\n` +
    `🔴 To'xtatilgan botlar: ${stats.stoppedBots}\n` +
    `🔗 Referallar (jami): ${stats.totalReferrals}\n\n` +
    `📅 Bugungi kun:\n` +
    `➕ Yangi foydalanuvchi: ${stats.today.newUsers}\n` +
    `➕ Yangi bot: ${stats.today.newBots}\n` +
    `➕ Yangi referal: ${stats.today.newReferrals}\n` +
    `📤 Yuborilgan broadcast: ${stats.today.broadcastsSent}`
  );
}

module.exports = {
  incrementDailyStat,
  getOverallStatistics,
  getStatisticsRange,
  formatOverallStatistics,
};
