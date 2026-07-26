const { User } = require('./database');
const { generateReferralCode } = require('./functions');
const logger = require('./logger');

async function findOrCreateUser(from) {
  let user = await User.findOne({ telegramId: from.id });
  if (user) {
    const patch = {};
    if (user.username !== from.username) patch.username = from.username || null;
    if (user.firstName !== from.first_name) patch.firstName = from.first_name || null;
    if (user.lastName !== from.last_name) patch.lastName = from.last_name || null;
    patch.lastSeenAt = new Date();
    if (Object.keys(patch).length) {
      await User.updateOne({ telegramId: from.id }, { $set: patch });
    }
    return { user, isNew: false };
  }

  let code;
  do {
    code = generateReferralCode(from.id);
    // eslint-disable-next-line no-await-in-loop
  } while (await User.exists({ referralCode: code }));

  user = await User.create({
    telegramId: from.id,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null,
    referralCode: code,
  });

  logger.info({ telegramId: from.id }, 'Yangi foydalanuvchi ro\'yxatdan o\'tdi');
  return { user, isNew: true };
}

async function getUserByTelegramId(telegramId) {
  return User.findOne({ telegramId });
}

async function blockUser(telegramId) {
  return User.updateOne({ telegramId }, { $set: { isBlocked: true } });
}

async function unblockUser(telegramId) {
  return User.updateOne({ telegramId }, { $set: { isBlocked: false } });
}

async function isUserBlocked(telegramId) {
  const user = await User.findOne({ telegramId }, { isBlocked: 1 });
  return !!user?.isBlocked;
}

async function getUsersPaginated(page = 1, limit = 10) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(),
  ]);
  return { items, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function searchUser(query) {
  if (/^\d+$/.test(query)) {
    return User.findOne({ telegramId: Number(query) });
  }
  return User.findOne({ username: query.replace('@', '') });
}

async function getAllActiveUserIds() {
  const users = await User.find({ isBlocked: false }, { telegramId: 1 }).lean();
  return users.map((u) => u.telegramId);
}

// ===================== RWCOIN BALANSI =====================

async function getRwcoin(telegramId) {
  const user = await User.findOne({ telegramId }, { rwcoin: 1 });
  return user ? user.rwcoin : 0;
}

async function addRwcoin(telegramId, amount) {
  if (!amount) return null;
  return User.findOneAndUpdate(
    { telegramId },
    { $inc: { rwcoin: amount } },
    { new: true }
  );
}

/**
 * Foydalanuvchi hisobidan RWcoin yechib oladi. Agar mablag' yetarli bo'lmasa false qaytaradi
 * va hisobga tegmaydi (atomik shart bilan).
 */
async function spendRwcoin(telegramId, amount) {
  if (!amount || amount <= 0) return true;
  const result = await User.updateOne(
    { telegramId, rwcoin: { $gte: amount } },
    { $inc: { rwcoin: -amount } }
  );
  return result.modifiedCount > 0;
}

module.exports = {
  findOrCreateUser,
  getUserByTelegramId,
  blockUser,
  unblockUser,
  isUserBlocked,
  getUsersPaginated,
  searchUser,
  getAllActiveUserIds,
  getRwcoin,
  addRwcoin,
  spendRwcoin,
};
