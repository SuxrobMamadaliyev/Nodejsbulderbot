const { Telegraf } = require('telegraf');
const config = require('./config');
const logger = require('./logger');

const { mainMenu, adminMenu, botListInline, botManageInline } = require('./buttons');
const { findOrCreateUser } = require('./users');
const { extractReferralCode } = require('./functions');
const { registerReferral, getReferralInfo } = require('./referral');
const { checkUserSubscription, listChannels } = require('./subscription');
const { renderProfile } = require('./profile');
const { getOverallStatistics, formatOverallStatistics, incrementDailyStat } = require('./statistics');
const { Bot } = require('./database');

const {
  rateLimitMiddleware,
  floodProtectionMiddleware,
  blockedUserMiddleware,
  mandatorySubscriptionMiddleware,
  adminOnlyMiddleware,
  isAdminUser,
} = require('./middlewares');

const builder = require('./builder');
const admin = require('./admin');
const { getState, clearState } = require('./states');

const bot = new Telegraf(config.botToken);

bot.catch((err, ctx) => {
  logger.error({ err: err.message, stack: err.stack }, 'Master bot xatoligi');
});

bot.use(rateLimitMiddleware());
bot.use(floodProtectionMiddleware());
bot.use(blockedUserMiddleware());

// ===================== /start =====================

bot.start(async (ctx) => {
  const payload = ctx.startPayload;
  const referralCode = extractReferralCode(payload);

  const { user, isNew } = await findOrCreateUser(ctx.from);

  if (isNew) {
    await incrementDailyStat('newUsers', 1);
  }

  if (isNew && referralCode) {
    const channels = await listChannels({ scope: 'master' });
    let isSubscribed = true;
    if (channels.length) {
      const result = await checkUserSubscription(ctx.telegram, ctx.from.id, channels);
      isSubscribed = result.isSubscribed;
    }
    if (isSubscribed) {
      const result = await registerReferral(referralCode, user);
      if (result.counted) {
        await incrementDailyStat('newReferrals', 1);
        if (result.creditGranted) {
          try {
            await ctx.telegram.sendMessage(
              result.referrer.telegramId,
              '🎉 Tabriklaymiz! Siz yetarli miqdorda referal to\'pladingiz va bepul bot yaratish huquqiga ega bo\'ldingiz!'
            );
          } catch (err) {
            // foydalanuvchi botni bloklagan bo'lishi mumkin
          }
        }
      }
    }
  }

  await ctx.reply(
    `👋 Xush kelibsiz, ${ctx.from.first_name}!\n\n` +
      `Bu yerda siz o'z Telegram botingizni mutlaqo bepul yaratishingiz mumkin.\n` +
      `Boshlash uchun quyidagi menyudan foydalaning 👇`,
    mainMenu
  );
});

// ===================== Majburiy obuna tekshiruvi (barcha keyingi handlerlar uchun) =====================

bot.use(mandatorySubscriptionMiddleware());

bot.action('check_subscription', async (ctx) => {
  const channels = await listChannels({ scope: 'master' });
  const { isSubscribed } = await checkUserSubscription(ctx.telegram, ctx.from.id, channels);
  if (isSubscribed) {
    await ctx.answerCbQuery('✅ Obuna tasdiqlandi!');
    await ctx.editMessageText('✅ Obuna tasdiqlandi! Endi botdan to\'liq foydalanishingiz mumkin.');
    await ctx.reply('Asosiy menyu:', mainMenu);
  } else {
    await ctx.answerCbQuery('❌ Siz hali barcha kanallarga obuna bo\'lmadingiz.', { show_alert: true });
  }
});

// ===================== ASOSIY MENYU =====================

bot.hears('🤖 Bot yaratish', builder.startBotCreation);

bot.hears('📂 Mening botlarim', async (ctx) => {
  const bots = await Bot.find({ ownerId: ctx.from.id }).sort({ createdAt: -1 });
  if (!bots.length) {
    return ctx.reply('📂 Sizda hali botlar yo\'q. "🤖 Bot yaratish" tugmasini bosib birinchi botingizni yarating!');
  }
  await ctx.reply(`📂 Sizning botlaringiz (${bots.length}):`, botListInline(bots));
});

bot.action(/botinfo_(.+)/, async (ctx) => {
  const botId = ctx.match[1];
  const botDoc = await Bot.findById(botId);
  if (!botDoc || (botDoc.ownerId !== ctx.from.id && !(await isAdminUser(ctx.from.id)))) {
    return ctx.answerCbQuery('Ruxsat yo\'q', { show_alert: true });
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🤖 ${botDoc.botName}\n` +
      `🔗 @${botDoc.botUsername}\n` +
      `📦 Shablon: ${botDoc.templateType}\n` +
      `Holat: ${botDoc.status === 'active' ? '🟢 Faol' : '🔴 To\'xtatilgan'}\n` +
      `💬 Xabarlar: ${botDoc.stats?.totalMessages || 0}`,
    botManageInline(botDoc._id.toString(), botDoc.status)
  );
});

bot.action('mybots_back', async (ctx) => {
  const bots = await Bot.find({ ownerId: ctx.from.id }).sort({ createdAt: -1 });
  await ctx.answerCbQuery();
  await ctx.editMessageText(`📂 Sizning botlaringiz (${bots.length}):`, botListInline(bots));
});

bot.action(/bot(start|stop|restart|delete)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const botId = ctx.match[2];
  const botDoc = await Bot.findById(botId);
  if (!botDoc || (botDoc.ownerId !== ctx.from.id && !(await isAdminUser(ctx.from.id)))) {
    return ctx.answerCbQuery('Ruxsat yo\'q', { show_alert: true });
  }
  return admin.handleBotAction(ctx, action, botId);
});

bot.hears('👥 Referallar', async (ctx) => {
  const me = await ctx.telegram.getMe();
  const info = await getReferralInfo(ctx.from.id, me.username);
  if (!info) return ctx.reply('❌ Ma\'lumot topilmadi.');
  await ctx.reply(
    `👥 Referal ma'lumotlari\n\n` +
      `🔗 Sizning referal havolangiz:\n${info.link}\n\n` +
      `👤 Jami referallar: ${info.referralsCount}\n` +
      `🎯 Talab qilinadigan referal: ${info.required}\n` +
      `⏳ Keyingi bot uchun qoldi: ${info.remaining || info.required}\n` +
      `🎁 Bepul bot kreditlari: ${info.freeBotCredits}`
  );
});

bot.hears('📊 Profil', async (ctx) => {
  const text = await renderProfile(ctx.from.id);
  await ctx.reply(text);
});

bot.hears('⚙️ Sozlamalar', async (ctx) => {
  await ctx.reply(
    '⚙️ Sozlamalar\n\nHozircha shaxsiy sozlamalar mavjud emas. Botlaringizni "📂 Mening botlarim" bo\'limidan boshqarishingiz mumkin.'
  );
});

bot.hears('🆘 Yordam', async (ctx) => {
  await ctx.reply(
    '🆘 Yordam\n\n' +
      '🤖 Bot yaratish — @BotFather orqali olingan token yordamida yangi bot yaratasiz.\n' +
      '📂 Mening botlarim — botlaringizni boshqarasiz (ishga tushirish/to\'xtatish/o\'chirish).\n' +
      '👥 Referallar — do\'stlaringizni taklif qilib bepul bot yaratish huquqini olasiz.\n' +
      '📊 Profil — hisobingiz haqida ma\'lumot.\n\n' +
      'Savollar bo\'lsa, administratorga murojaat qiling.'
  );
});

// ===================== ADMIN PANEL =====================

bot.hears('👨‍💻 Admin', adminOnlyMiddleware(), admin.openAdminPanel);
bot.command('admin', adminOnlyMiddleware(), admin.openAdminPanel);

bot.hears('⬅️ Asosiy menyu', async (ctx) => ctx.reply('Asosiy menyu:', mainMenu));

bot.hears('👥 Foydalanuvchilar', adminOnlyMiddleware(), async (ctx) => admin.showUsers(ctx, 1));
bot.hears('🤖 Botlar', adminOnlyMiddleware(), admin.showAllBots);
bot.hears('📢 Kanallar', adminOnlyMiddleware(), admin.showChannels);
bot.hears('🔗 Referallar', adminOnlyMiddleware(), async (ctx) => {
  const { getTopReferrers } = require('./referral');
  const top = await getTopReferrers(10);
  if (!top.length) return ctx.reply('Hali referallar mavjud emas.');
  const lines = top.map((u, i) => `${i + 1}. ${u.username ? '@' + u.username : u.telegramId} — ${u.referralsCount} ta`);
  await ctx.reply(`🏆 Top referallar:\n\n${lines.join('\n')}`);
});
bot.hears('📤 Broadcast', adminOnlyMiddleware(), admin.startBroadcastFlow);
bot.hears('📊 Statistika', adminOnlyMiddleware(), async (ctx) => {
  const stats = await getOverallStatistics();
  await ctx.reply(formatOverallStatistics(stats));
});
bot.hears('📜 Loglar', adminOnlyMiddleware(), admin.showRecentLogs);

bot.action(/blockuser_(\d+)/, adminOnlyMiddleware(), (ctx) => admin.toggleBlockUser(ctx, Number(ctx.match[1]), true));
bot.action(/unblockuser_(\d+)/, adminOnlyMiddleware(), (ctx) => admin.toggleBlockUser(ctx, Number(ctx.match[1]), false));

bot.action('broadcast_confirm', adminOnlyMiddleware(), admin.executeBroadcast);
bot.action('broadcast_cancel', adminOnlyMiddleware(), async (ctx) => {
  clearState(admin.SCOPE, ctx.from.id);
  await ctx.answerCbQuery('Bekor qilindi');
  await ctx.editMessageText('❌ Broadcast bekor qilindi.');
});

bot.action(/tpl_(blank|subscription|autoreply|autoforward|shop|lottery|support)/, builder.handleTemplateSelection);

bot.action('noop', (ctx) => ctx.answerCbQuery());

// ===================== MATNLI XABARLAR (state-based routing) =====================

bot.on('text', async (ctx, next) => {
  // Avval builder (bot yaratish) state'ini tekshiramiz
  const handledByBuilder = await builder.handleBuilderText(ctx);
  if (handledByBuilder) return;

  // Admin state'larini tekshiramiz
  const adminState = getState(admin.SCOPE, ctx.from.id);
  if (adminState) {
    const isAdmin = await isAdminUser(ctx.from.id);
    if (!isAdmin) {
      clearState(admin.SCOPE, ctx.from.id);
      return next();
    }
    const text = ctx.message.text;
    if (text === '❌ Bekor qilish') {
      clearState(admin.SCOPE, ctx.from.id);
      await ctx.reply('❌ Bekor qilindi.', adminMenu);
      return;
    }
    switch (adminState.step) {
      case 'awaiting_user_search':
        clearState(admin.SCOPE, ctx.from.id);
        return admin.resolveUserSearch(ctx, text);
      case 'awaiting_referral_count':
        return admin.handleReferralCountInput(ctx);
      default:
        if (adminState.step && adminState.step.startsWith('awaiting_')) {
          // kanal qo'shish oqimi kanal ro'yxati ochiq bo'lganda ishlaydi
        }
        break;
    }
  }

  // Kanal qo'shish: agar oxirgi xabar "📢 Kanallar" bo'lsa alohida state kerak emas,
  // shuning uchun mavjud kanal formatini tekshiramiz va admin bo'lsa qo'shishga urinamiz.
  const { isValidChannelInput } = require('./security');
  if (isValidChannelInput(ctx.message.text) && (await isAdminUser(ctx.from.id))) {
    return admin.handleAddChannel(ctx, ctx.telegram);
  }

  return next();
});

// Broadcast mazmuni (matn bo'lmagan turlar: rasm, video va h.k.)
bot.on(['photo', 'video', 'audio', 'voice', 'animation', 'sticker', 'document'], async (ctx, next) => {
  const adminState = getState(admin.SCOPE, ctx.from.id);
  if (adminState && adminState.step === 'awaiting_broadcast_content' && (await isAdminUser(ctx.from.id))) {
    return admin.handleBroadcastContent(ctx);
  }
  return next();
});

// Broadcast matn kontenti va tugmalar bosqichi uchun alohida ushlash
bot.on('text', async (ctx, next) => {
  const adminState = getState(admin.SCOPE, ctx.from.id);
  if (!adminState) return next();
  if (adminState.step === 'awaiting_broadcast_content' && (await isAdminUser(ctx.from.id))) {
    return admin.handleBroadcastContent(ctx);
  }
  if (adminState.step === 'awaiting_broadcast_buttons' && (await isAdminUser(ctx.from.id))) {
    return admin.handleBroadcastButtonsAndConfirm(ctx);
  }
  return next();
});

module.exports = bot;
