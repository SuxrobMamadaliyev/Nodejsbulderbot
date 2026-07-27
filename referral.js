const { User, Referral } = require('./database');
const { buildReferralLink } = require('./functions');
const { getRwcoinPerReferral } = require('./settings');
const { addRwcoin } = require('./users');
const logger = require('./logger');

/**
 * Referalni hisoblash. Faqat quyidagi shartlarda hisoblanadi:
 * - yangi foydalanuvchi (isNew === true)
 * - /start orqali kirgan
 * - barcha kanallarga obuna (chaqiruvchi joyda tekshiriladi va isSubscribed=true bo'lgandagina chaqiriladi)
 * - oldin referal bo'lmagan (referredBy hali null bo'lishi kerak)
 *
 * Har bir hisoblangan referal uchun chaqiruvchiga RWcoin beriladi.
 * Botlar FAQAT RWcoin orqali sotib olinadi - "N ta referal = 1 bepul bot" tizimi olib tashlangan.
 */
async function registerReferral(referrerCode, newUser) {
  if (!referrerCode) return { counted: false, reason: 'no_code' };
  if (newUser.referredBy) return { counted: false, reason: 'already_referred' };

  const referrer = await User.findOne({ referralCode: referrerCode });
  if (!referrer) return { counted: false, reason: 'referrer_not_found' };
  if (referrer.telegramId === newUser.telegramId) return { counted: false, reason: 'self_referral' };

  const existing = await Referral.findOne({ referredId: newUser.telegramId });
  if (existing) return { counted: false, reason: 'duplicate' };

  await Referral.create({ referrerId: referrer.telegramId, referredId: newUser.telegramId, counted: true });

  referrer.referralsCount += 1;
  newUser.referredBy = referrer.telegramId;
  await Promise.all([referrer.save(), newUser.save()]);

  // Har bir referal uchun RWcoin beriladi - RWcoin auksionda ishtirok etish
  // yoki to'g'ridan-to'g'ri bot sotib olish uchun ishlatiladi.
  const rwcoinPerReferral = await getRwcoinPerReferral();
  if (rwcoinPerReferral > 0) {
    await addRwcoin(referrer.telegramId, rwcoinPerReferral);
  }

  logger.info(
    { referrer: referrer.telegramId, referred: newUser.telegramId, rwcoinPerReferral },
    'Referal muvaffaqiyatli hisoblandi'
  );

  return { counted: true, referrer, rwcoinGranted: rwcoinPerReferral };
}

/**
 * Foydalanuvchi /start bosganda hali kanallarga obuna bo'lmagan bo'lsa,
 * referal kodini vaqtincha saqlab qo'yamiz - keyinroq "Obuna bo'ldim"
 * tugmasini bosganda shu kod orqali referalni hisoblash imkoni bo'lsin.
 */
async function savePendingReferral(newUser, referrerCode) {
  if (!referrerCode) return;
  if (newUser.referredBy) return;
  if (newUser.pendingReferralCode) return; // birinchi kelgan referal kodi saqlanadi
  newUser.pendingReferralCode = referrerCode;
  await newUser.save();
}

/**
 * Foydalanuvchi obunani tasdiqlagandan (yoki keyingi safar botga kirganda)
 * saqlangan pendingReferralCode bo'yicha referalni hisoblashga urinadi.
 */
async function tryRegisterPendingReferral(newUser) {
  if (!newUser.pendingReferralCode || newUser.referredBy) return { counted: false, reason: 'no_pending' };
  const result = await registerReferral(newUser.pendingReferralCode, newUser);
  if (result.counted || result.reason !== 'referrer_not_found') {
    // Muvaffaqiyatli hisoblandi yoki qayta urinishga hojat yo'q sabab - pending kodni tozalaymiz
    newUser.pendingReferralCode = null;
    await newUser.save();
  }
  return result;
}

async function getReferralInfo(telegramId, botUsername) {
  const user = await User.findOne({ telegramId });
  if (!user) return null;
  const rwcoinPerReferral = await getRwcoinPerReferral();
  return {
    link: buildReferralLink(botUsername, user.referralCode),
    referralsCount: user.referralsCount,
    rwcoin: user.rwcoin,
    rwcoinPerReferral,
  };
}

async function getTopReferrers(limit = 10) {
  return User.find({ referralsCount: { $gt: 0 } })
    .sort({ referralsCount: -1 })
    .limit(limit)
    .select('telegramId username referralsCount');
}

module.exports = {
  registerReferral,
  savePendingReferral,
  tryRegisterPendingReferral,
  getReferralInfo,
  getTopReferrers,
};
