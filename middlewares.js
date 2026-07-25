const config = require('./config');
const { isRateLimited, isFlooding } = require('./security');
const { listChannels, checkUserSubscription } = require('./subscription');
const { subscriptionCheckInline } = require('./buttons');
const { isUserBlocked } = require('./users');
const { Admin } = require('./database');
const logger = require('./logger');

function rateLimitMiddleware() {
  return async (ctx, next) => {
    if (!ctx.from) return next();
    const limited = await isRateLimited(ctx.from.id);
    if (limited) {
      logger.warn({ userId: ctx.from.id }, 'Foydalanuvchi rate-limitga tushdi');
      return;
    }
    return next();
  };
}

function floodProtectionMiddleware() {
  return async (ctx, next) => {
    if (!ctx.from) return next();
    const flooding = await isFlooding(ctx.from.id);
    if (flooding) {
      return;
    }
    return next();
  };
}

function blockedUserMiddleware() {
  return async (ctx, next) => {
    if (!ctx.from) return next();
    const blocked = await isUserBlocked(ctx.from.id);
    if (blocked) {
      return ctx.reply('🚫 Siz botdan foydalanish huquqidan mahrum qilingansiz.');
    }
    return next();
  };
}

function mandatorySubscriptionMiddleware() {
  return async (ctx, next) => {
    if (!ctx.from) return next();

    // Obuna tekshiruvi tugmasini alohida o'tkazamiz
    if (ctx.updateType === 'callback_query' && ctx.callbackQuery?.data === 'check_subscription') {
      return next();
    }

    const channels = await listChannels({ scope: 'master' });
    if (!channels.length) return next();

    const { isSubscribed, notSubscribed } = await checkUserSubscription(ctx.telegram, ctx.from.id, channels);
    if (!isSubscribed) {
      await ctx.reply(
        '⚠️ Botdan foydalanish uchun quyidagi kanal(lar)ga obuna bo\'ling, so\'ng "Obuna bo\'ldim" tugmasini bosing:',
        subscriptionCheckInline(notSubscribed, 'check_subscription')
      );
      return;
    }
    return next();
  };
}

async function isAdminUser(telegramId) {
  if (config.superAdminIds.includes(telegramId)) return true;
  const admin = await Admin.findOne({ telegramId });
  return !!admin;
}

function adminOnlyMiddleware() {
  return async (ctx, next) => {
    if (!ctx.from) return;
    const isAdmin = await isAdminUser(ctx.from.id);
    if (!isAdmin) {
      return ctx.reply('🚫 Bu bo\'lim faqat administratorlar uchun.');
    }
    return next();
  };
}

module.exports = {
  rateLimitMiddleware,
  floodProtectionMiddleware,
  blockedUserMiddleware,
  mandatorySubscriptionMiddleware,
  adminOnlyMiddleware,
  isAdminUser,
};
