const { Telegraf } = require('telegraf');
const config = require('./config');
const logger = require('./logger');

const { mainMenu, adminMenu, botListInline, botManageInline, referralShareInline, auctionListInline, auctionDetailInline } = require('./buttons');
const { getTemplateList } = require('./templates');
const { findOrCreateUser, getCoins } = require('./users');
const { extractReferralCode } = require('./functions');
const { registerReferral, getReferralInfo } = require('./referral');
const { checkUserSubscription, listChannels } = require('./subscription');
const { renderProfile } = require('./profile');
const { getOverallStatistics, formatOverallStatistics, incrementDailyStat } = require('./statistics');
const { getBotPriceCoins } = require('./settings');
const { getActiveAuctions, getAuctionById, placeBid } = require('./auction');
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
      `🎁 Bepul bot kreditlari: ${info.freeBotCredits}`,
    referralShareInline(info.link, '🤖 Bepul Telegram bot yaratish uchun shu havoladan foydalaning!')
  );
});

bot.hears('📊 Profil', async (ctx) => {
  const text = await renderProfile(ctx.from.id);
  await ctx.reply(text);
});

// ===================== KOIN =====================

bot.hears('🪙 Koinlarim', async (ctx) => {
  const coins = await getCoins(ctx.from.id);
  const botPrice = await getBotPriceCoins();
  const me = await ctx.telegram.getMe();
  const info = await getReferralInfo(ctx.from.id, me.username);
  await ctx.reply(
    `🪙 Koin balansingiz: ${coins}\n\n` +
      `👥 Har bir referal uchun: ${info ? info.coinsPerReferral : '-'} koin olasiz.\n` +
      `🤖 Bot narxi: ${botPrice} koin (bot yaratishda referal krediti bo'lmasa, koin bilan sotib olishingiz mumkin).\n` +
      `🏆 Koiningizni ko'paytirish uchun "🏆 Auksion" bo'limiga o'ting!`,
    info ? referralShareInline(info.link, '🪙 Koin yig\'ish uchun shu havoladan foydalaning!') : undefined
  );
});

// ===================== AUKSION =====================

bot.hears('🏆 Auksion', async (ctx) => {
  const auctions = await getActiveAuctions();
  if (!auctions.length) {
    return ctx.reply('🏆 Hozircha faol auksionlar mavjud emas.');
  }
  await ctx.reply(`🏆 Faol auksionlar (${auctions.length}):`, auctionListInline(auctions));
});

async function renderAuctionDetail(auction) {
  const msLeft = auction.endsAt.getTime() - Date.now();
  const minutesLeft = Math.max(0, Math.ceil(msLeft / 60000));
  return (
    `🏆 ${auction.title}\n` +
    `${auction.description ? `📝 ${auction.description}\n` : ''}` +
    `🪙 Joriy stavka: ${auction.currentBid || auction.minBid}\n` +
    `🎁 G'olibga bonus: +${auction.potCoins} koin\n` +
    `⏱ Tugashiga: ${minutesLeft} daqiqa\n\n` +
    `Kimda eng yuqori stavka bo'lsa, auksion tugaganda o'z stavkasi + bonusni oladi!`
  );
}

bot.action(/auction_view_(.+)/, async (ctx) => {
  const auction = await getAuctionById(ctx.match[1]);
  if (!auction) return ctx.answerCbQuery('Auksion topilmadi', { show_alert: true });
  await ctx.answerCbQuery();
  await ctx.editMessageText(await renderAuctionDetail(auction), auctionDetailInline(auction._id.toString()));
});

bot.action('auction_back', async (ctx) => {
  const auctions = await getActiveAuctions();
  await ctx.answerCbQuery();
  if (!auctions.length) {
    return ctx.editMessageText('🏆 Hozircha faol auksionlar mavjud emas.');
  }
  await ctx.editMessageText(`🏆 Faol auksionlar (${auctions.length}):`, auctionListInline(auctions));
});

const AUCTION_SCOPE = 'auction';

bot.action(/auction_bid_(.+)/, async (ctx) => {
  const auctionId = ctx.match[1];
  const auction = await getAuctionById(auctionId);
  if (!auction || auction.status !== 'active') {
    return ctx.answerCbQuery('Auksion faol emas', { show_alert: true });
  }
  await ctx.answerCbQuery();
  const { setState } = require('./states');
  setState(AUCTION_SCOPE, ctx.from.id, 'awaiting_bid_amount', { auctionId });
  const minRequired = Math.max(auction.minBid, auction.currentBid + 1);
  await ctx.reply(`💰 Stavkangizni kiriting (koinda). Minimal: ${minRequired}`);
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
bot.hears('🧩 Shablon yuklash', adminOnlyMiddleware(), admin.showTemplateUploadPrompt);
bot.hears('⚙️ Referal sozlamalari', adminOnlyMiddleware(), admin.showAdminSettings);
bot.hears('🏆 Auksion yaratish', adminOnlyMiddleware(), admin.startAuctionCreation);
bot.hears('🪙 Koin sozlamalari', adminOnlyMiddleware(), admin.showCoinSettings);

bot.action(/blockuser_(\d+)/, adminOnlyMiddleware(), (ctx) => admin.toggleBlockUser(ctx, Number(ctx.match[1]), true));
bot.action(/unblockuser_(\d+)/, adminOnlyMiddleware(), (ctx) => admin.toggleBlockUser(ctx, Number(ctx.match[1]), false));

bot.action('broadcast_confirm', adminOnlyMiddleware(), admin.executeBroadcast);
bot.action('broadcast_cancel', adminOnlyMiddleware(), async (ctx) => {
  clearState(admin.SCOPE, ctx.from.id);
  await ctx.answerCbQuery('Bekor qilindi');
  await ctx.editMessageText('❌ Broadcast bekor qilindi.');
});

bot.action(/tpl_(.+)/, builder.handleTemplateSelection);

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
      case 'awaiting_coins_per_referral':
        return admin.handleCoinsPerReferralInput(ctx);
      case 'awaiting_bot_price_coins':
        return admin.handleBotPriceCoinsInput(ctx);
      case 'awaiting_auction_title':
      case 'awaiting_auction_description':
      case 'awaiting_auction_min_bid':
      case 'awaiting_auction_pot':
      case 'awaiting_auction_duration':
        return admin.handleAuctionCreationInput(ctx);
      default:
        if (adminState.step && adminState.step.startsWith('awaiting_')) {
          // kanal qo'shish oqimi kanal ro'yxati ochiq bo'lganda ishlaydi
        }
        break;
    }
  }

  // Auksionda stavka miqdorini kiritish
  const auctionState = getState(AUCTION_SCOPE, ctx.from.id);
  if (auctionState && auctionState.step === 'awaiting_bid_amount') {
    const text = (ctx.message.text || '').trim();
    if (text === '❌ Bekor qilish') {
      clearState(AUCTION_SCOPE, ctx.from.id);
      await ctx.reply('❌ Bekor qilindi.', mainMenu);
      return;
    }
    const amount = parseInt(text, 10);
    if (Number.isNaN(amount) || amount < 1) {
      await ctx.reply('❌ Noto\'g\'ri miqdor. Musbat raqam kiriting.');
      return;
    }
    const result = await placeBid(auctionState.data.auctionId, ctx.from.id, amount);
    clearState(AUCTION_SCOPE, ctx.from.id);
    if (!result.ok) {
      const messages = {
        not_found: '❌ Auksion topilmadi.',
        ended: '❌ Auksion allaqachon tugagan.',
        too_low: `❌ Stavka juda kichik. Minimal: ${result.minRequired || ''}`,
        already_leading: '✅ Siz allaqachon yetakchisiz!',
        no_coins: '❌ Koiningiz yetarli emas.',
        race_condition: '❌ Boshqa foydalanuvchi ayni damda stavka qo\'ydi, qaytadan urinib ko\'ring.',
      };
      await ctx.reply(messages[result.reason] || '❌ Xatolik yuz berdi.');
      return;
    }
    await ctx.reply(`✅ Stavkangiz qabul qilindi: ${amount} koin! Hozircha yetakchisiz.`);
    if (result.previousBidderId) {
      try {
        await ctx.telegram.sendMessage(
          result.previousBidderId,
          `⚠️ Sizning auksiondagi stavkangiz oshirib yuborildi. ${result.previousBid} koiningiz hisobingizga qaytarildi.`
        );
      } catch (err) {
        // foydalanuvchi botni bloklagan bo'lishi mumkin
      }
    }
    return;
  }

  // Kanal qo'shish: agar oxirgi xabar "📢 Kanallar" bo'lsa alohida state kerak emas,
  // shuning uchun mavjud kanal formatini tekshiramiz va admin bo'lsa qo'shishga urinamiz.
  const { isValidChannelInput } = require('./security');
  if (isValidChannelInput(ctx.message.text) && (await isAdminUser(ctx.from.id))) {
    return admin.handleAddChannel(ctx, ctx.telegram);
  }

  return next();
});

// Maxsus shablon fayli (.js) yuklash
bot.on('document', async (ctx, next) => {
  const adminState = getState(admin.SCOPE, ctx.from.id);
  if (adminState && adminState.step === 'awaiting_template_file' && (await isAdminUser(ctx.from.id))) {
    return admin.handleTemplateFileUpload(ctx);
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
