const { User, Referral } = require('./database');
const { buildReferralLink } = require('./functions');
const { getReferralRequired, getBotsPerReferralBatch } = require('./settings');
const { grantFreeBotCredit } = require('./users');
const logger = require('./logger');

/**
 * Referalni hisoblash. Faqat quyidagi shartlarda hisoblanadi:
 * - yangi foydalanuvchi (isNew === true)
 * - /start orqali kirgan
 * - barcha kanallarga obuna (chaqiruvchi joyda tekshiriladi va isSubscribed=true bo'lgandagina chaqiriladi)
 * - oldin referal bo'lmagan (referredBy hali null bo'lishi kerak)
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

  const required = await getReferralRequired();
  let creditGranted = false;
  if (required > 0 && referrer.referralsCount % required === 0) {
    const batch = await getBotsPerReferralBatch();
    await grantFreeBotCredit(referrer.telegramId, batch);
    creditGranted = true;
  }

  logger.info(
    { referrer: referrer.telegramId, referred: newUser.telegramId },
    'Referal muvaffaqiyatli hisoblandi'
  );

  return { counted: true, referrer, creditGranted };
}

async function getReferralInfo(telegramId, botUsername) {
  const user = await User.findOne({ telegramId });
  if (!user) return null;
  const required = await getReferralRequired();
  const remainder = required > 0 ? user.referralsCount % required : 0;
  const remaining = required > 0 ? required - remainder : 0;
  return {
    link: buildReferralLink(botUsername, user.referralCode),
    referralsCount: user.referralsCount,
    freeBotCredits: user.freeBotCredits,
    required,
    remaining: remaining === required ? 0 : remaining,
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
  getReferralInfo,
  getTopReferrers,
};
