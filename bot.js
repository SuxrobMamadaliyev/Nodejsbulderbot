const { Telegraf } = require('telegraf');
const config = require('./config');
const logger = require('./logger');

const { mainMenuInline, backToMainMenuInline, adminMenu, botListInline, botManageInline, referralShareInline, auctionListInline, auctionDetailInline, channelAuctionInline, auctionInactiveInline } = require('./buttons');
const { getTemplateList } = require('./templates');
const { findOrCreateUser, getRwcoin } = require('./users');
const { extractReferralCode, getFullName, escapeHtml } = require('./functions');
const { registerReferral, savePendingReferral, tryRegisterPendingReferral, getReferralInfo } = require('./referral');
const { checkUserSubscription, listChannels } = require('./subscription');
const { renderProfile } = require('./profile');
const { getOverallStatistics, formatOverallStatistics, incrementDailyStat } = require('./statistics');
const { getActiveAuctions, getAuctionById, placeBid, createAuction, MIN_USER_AUCTION_BID, MAX_BID_STEP, BID_EXTENSION_MINUTES, MIN_BIDS_TO_END, WINNER_PAYOUT_PERCENT, renderChannelAuctionText } = require('./auction');
const { Bot } = require('./database');
const { Markup } = require('telegraf');

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
const { getState, clearState, setState } = require('./states');

const bot = new Telegraf(config.botToken);

async function notifyReferralGranted(ctx, result) {
  if (!result || !result.counted) return;
  await incrementDailyStat('newReferrals', 1);
  if (result.rwcoinGranted) {
    try {
      await ctx.telegram.sendMessage(
        result.referrer.telegramId,
        `🎉 Yangi referal! Hisobingizga ${result.rwcoinGranted} RWcoin qo'shildi.`
      );
    } catch (err) {
      // foydalanuvchi botni bloklagan bo'lishi mumkin
    }
  }
}

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
      await notifyReferralGranted(ctx, result);
    } else {
      // Foydalanuvchi hali obuna bo'lmagan - referal kodini yo'qotib qo'ymaslik uchun
      // saqlab qo'yamiz, keyin "Obuna bo'ldim" tugmasi bosilganda hisoblanadi.
      await savePendingReferral(user, referralCode);
    }
  }

  await ctx.reply(
    `👋 Xush kelibsiz, ${ctx.from.first_name}!\n\n` +
      `Bu yerda siz o'z Telegram botingizni RWcoin evaziga yaratishingiz mumkin.\n` +
      `RWcoinni referal orqali yig'ing yoki auksionda ko'paytiring!\n` +
      `Boshlash uchun quyidagi menyudan foydalaning 👇`,
    mainMenuInline(await isAdminUser(ctx.from.id))
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

    // Agar oldin saqlab qo'yilgan referal kodi bo'lsa, endi hisoblaymiz
    const { user } = await findOrCreateUser(ctx.from);
    const result = await tryRegisterPendingReferral(user);
    await notifyReferralGranted(ctx, result);

    await ctx.reply('Asosiy menyu:', mainMenuInline(await isAdminUser(ctx.from.id)));
  } else {
    await ctx.answerCbQuery('❌ Siz hali barcha kanallarga obuna bo\'lmadingiz.', { show_alert: true });
  }
});

// ===================== ASOSIY MENYU =====================

bot.hears('🤖 Bot yaratish', builder.startBotCreation);
bot.action('menu_create_bot', async (ctx) => {
  await ctx.answerCbQuery();
  return builder.startBotCreation(ctx);
});

async function showMyBots(ctx) {
  const bots = await Bot.find({ ownerId: ctx.from.id }).sort({ createdAt: -1 });
  if (!bots.length) {
    return ctx.reply('📂 Sizda hali botlar yo\'q. "🤖 Bot yaratish" tugmasini bosib birinchi botingizni yarating!');
  }
  await ctx.reply(`📂 Sizning botlaringiz (${bots.length}):`, botListInline(bots));
}
bot.hears('📂 Mening botlarim', showMyBots);
bot.action('menu_my_bots', async (ctx) => {
  await ctx.answerCbQuery();
  return showMyBots(ctx);
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

async function showReferrals(ctx) {
  const me = await ctx.telegram.getMe();
  const info = await getReferralInfo(ctx.from.id, me.username);
  if (!info) return ctx.reply('❌ Ma\'lumot topilmadi.');
  await ctx.reply(
    `👥 Referal ma'lumotlari\n\n` +
      `🔗 Sizning referal havolangiz:\n${info.link}\n\n` +
      `👤 Jami referallar: ${info.referralsCount}\n` +
      `💰 Har bir referal uchun: ${info.rwcoinPerReferral} RWcoin\n` +
      `🪙 Hozirgi RWcoin balansingiz: ${info.rwcoin}\n\n` +
      `Yig'gan RWcoiningiz bilan "🤖 Bot yaratish" bo'limida bot sotib olishingiz mumkin!`,
    referralShareInline(info.link, '🤖 RWcoin yig\'ish uchun shu havoladan foydalaning!')
  );
}
bot.hears('👥 Referallar', showReferrals);
bot.action('menu_referrals', async (ctx) => {
  await ctx.answerCbQuery();
  return showReferrals(ctx);
});

async function showProfile(ctx) {
  const text = await renderProfile(ctx.from.id);
  await ctx.reply(text, backToMainMenuInline());
}
bot.hears('📊 Profil', showProfile);
bot.action('menu_profile', async (ctx) => {
  await ctx.answerCbQuery();
  return showProfile(ctx);
});

// ===================== RWCOIN =====================

bot.hears('💰 RWcoin', async (ctx) => {
  const rwcoin = await getRwcoin(ctx.from.id);
  const me = await ctx.telegram.getMe();
  const info = await getReferralInfo(ctx.from.id, me.username);
  await ctx.reply(
    `🪙 RWcoin balansingiz: ${rwcoin}\n\n` +
      `👥 Har bir referal uchun: ${info ? info.rwcoinPerReferral : '-'} RWcoin olasiz.\n` +
      `🤖 Botlar faqat RWcoin evaziga sotib olinadi - har bir bot turining o'z narxi bor ("🤖 Bot yaratish" bo'limida ko'rasiz).\n` +
      `🏆 RWcoiningizni ko'paytirish uchun "🏆 Auksion" bo'limiga o'ting!`,
    info ? referralShareInline(info.link, '🪙 RWcoin yig\'ish uchun shu havoladan foydalaning!') : undefined
  );
});

// ===================== AUKSION =====================

const AUCTION_RULES_TEXT =
  `👨‍⚖️ Auksion qoidalari:\n` +
  `⚜️ Auksionni ${MIN_USER_AUCTION_BID} RWcoindan boshlashingiz mumkin.\n` +
  `⚜️ Auksion ${MIN_BIDS_TO_END} ta garovga yetganda tugashi mumkin.\n` +
  `⚜️ Har qanday ishtirokchi oldingi garovni oshirishi mumkin.\n` +
  `⚜️ Maksimal o'sish bosqichi - ${MAX_BID_STEP} RWcoin.\n` +
  `⚜️ Garov ko'tarilgandan so'ng, auksion ${BID_EXTENSION_MINUTES} daqiqaga uzaytiriladi.\n` +
  `⚜️ Taymer nolga yetganda, oxirgi garovchi g'olib bo'ladi.\n` +
  `⚜️ Foydalanuvchi ketma-ket pul tika olmaydi.\n` +
  `⚜️ G'olib bankdan ${Math.round(WINNER_PAYOUT_PERCENT * 100)}% oladi.`;

// Auksion kanaliga havola quramiz: @username bo'lsa to'g'ridan-to'g'ri,
// bo'lmasa kanalning taklif havolasini so'raymiz.
async function getAuctionChannelUrl(telegram) {
  if (!config.auctionChannelId) return null;
  try {
    const chat = await telegram.getChat(config.auctionChannelId);
    if (chat.username) return `https://t.me/${chat.username}`;
    if (chat.invite_link) return chat.invite_link;
  } catch (err) {
    logger.warn({ err: err.message }, 'Auksion kanal linkini olishda xatolik');
  }
  return null;
}

async function showAuctionSection(ctx) {
  const auctions = await getActiveAuctions();
  const channelUrl = await getAuctionChannelUrl(ctx.telegram);
  if (!auctions.length) {
    return ctx.reply(`${AUCTION_RULES_TEXT}\n\n⚪ Auksion hozirda faol emas.`, auctionInactiveInline(channelUrl));
  }
  const keyboard = channelUrl ? Markup.inlineKeyboard([[Markup.button.url('📢 Auksion kanalimiz', channelUrl)]]) : undefined;
  await ctx.reply(
    `${AUCTION_RULES_TEXT}\n\n🟢 Hozir auksion faol! Ishtirok etish uchun auksion kanaliga o'ting.`,
    keyboard
  );
}
bot.hears('🏆 Auksion', showAuctionSection);
bot.action('menu_auction', async (ctx) => {
  await ctx.answerCbQuery();
  return showAuctionSection(ctx);
});

async function renderAuctionDetail(auction) {
  const msLeft = auction.endsAt.getTime() - Date.now();
  const minutesLeft = Math.max(0, Math.ceil(msLeft / 60000));
  return (
    `🏆 ${auction.title}\n` +
    `${auction.description ? `📝 ${auction.description}\n` : ''}` +
    `💰 Joriy stavka: ${auction.currentBid || auction.minBid} RWcoin\n` +
    `🏦 Auksion banki: ${auction.bank} RWcoin\n` +
    `⏱ Tugashiga: ${minutesLeft} daqiqa\n\n` +
    `Auksion tugaganda oxirgi garovchi g'olib bo'ladi va bankning ${Math.round(WINNER_PAYOUT_PERCENT * 100)}%ini oladi. Boshqa ishtirokchilarning coinlari qaytarilmaydi!`
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
  setState(AUCTION_SCOPE, ctx.from.id, 'awaiting_bid_amount', { auctionId });
  const minRequired = Math.max(auction.minBid, auction.currentBid + 1);
  await ctx.reply(`💰 Stavkangizni kiriting (RWcoinda). Minimal: ${minRequired}`);
});

// ===================== FOYDALANUVCHI O'Z AUKSIONINI BOSHLAYDI =====================
// Har qanday foydalanuvchi kamida MIN_USER_AUCTION_BID RWcoin bilan auksion
// boshlashi mumkin. Auksion "🏆 Auksion" bo'limida ham, sozlangan bo'lsa
// AUCTION_CHANNEL_ID kanalida jonli e'lon sifatida ham ko'rinadi.

const USER_AUCTION_SCOPE = 'user_auction';
const USER_AUCTION_DURATION_MINUTES = BID_EXTENSION_MINUTES; // 10 daqiqa - har garovdan so'ng yana shuncha uzayadi

async function postAuctionToChannel(ctx, auction) {
  if (!config.auctionChannelId) return;
  try {
    const me = await ctx.telegram.getMe();
    const sent = await ctx.telegram.sendMessage(
      config.auctionChannelId,
      renderChannelAuctionText(auction),
      { parse_mode: 'HTML', ...channelAuctionInline(auction, me.username) }
    );
    auction.channelMessageId = sent.message_id;
    await auction.save();
  } catch (err) {
    logger.warn({ err: err.message }, 'Auksionni kanalga joylashda xatolik');
  }
}

bot.action('start_own_auction', async (ctx) => {
  await ctx.answerCbQuery();
  const activeAuctions = await getActiveAuctions();
  if (activeAuctions.length) {
    const channelUrl = await getAuctionChannelUrl(ctx.telegram);
    return ctx.reply(
      '⚪ Hozir allaqachon faol auksion bor. Iltimos, u tugashini kuting yoki unga qo\'shiling.',
      channelUrl ? Markup.inlineKeyboard([[Markup.button.url('📢 Auksion kanalimiz', channelUrl)]]) : undefined
    );
  }
  const rwcoin = await getRwcoin(ctx.from.id);
  if (rwcoin < MIN_USER_AUCTION_BID) {
    return ctx.reply(`❌ Auksion boshlash uchun kamida ${MIN_USER_AUCTION_BID} RWcoin kerak. Sizda: ${rwcoin} RWcoin.`);
  }
  setState(USER_AUCTION_SCOPE, ctx.from.id, 'awaiting_own_garov', {});
  await ctx.reply(
    `⭐ Auksionni boshlash uchun garov miqdorini yuboring.\n\nKamida ${MIN_USER_AUCTION_BID} RWcoin. Balansingiz: ${rwcoin} RWcoin.`
  );
});

bot.action(/chaucbal_(.+)/, async (ctx) => {
  const rwcoin = await getRwcoin(ctx.from.id);
  return ctx.answerCbQuery(`💳 Balansingiz: ${rwcoin} RWcoin`, { show_alert: true });
});

bot.action(/chauc_(.+)_(\d+)/, async (ctx) => {
  const auctionId = ctx.match[1];
  const amount = parseInt(ctx.match[2], 10);
  const result = await placeBid(auctionId, ctx.from.id, amount, getFullName(ctx.from));
  if (!result.ok) {
    const messages = {
      not_found: '❌ Auksion topilmadi.',
      ended: '❌ Auksion allaqachon tugagan.',
      too_low: '❌ Bu stavka allaqachon eskirgan, yangilangan tugmalardan foydalaning.',
      too_high: `❌ Bir martada ko'pi bilan ${MAX_BID_STEP} RWcoinga oshirish mumkin.`,
      already_leading: '⚠️ Siz allaqachon yetakchisiz, ketma-ket ikki marta stavka qo\'ya olmaysiz.',
      no_rwcoin: '❌ RWcoiningiz yetarli emas.',
      race_condition: '❌ Boshqa foydalanuvchi ayni damda stavka qo\'ydi, qaytadan urinib ko\'ring.',
    };
    return ctx.answerCbQuery(messages[result.reason] || '❌ Xatolik yuz berdi.', { show_alert: true });
  }
  await ctx.answerCbQuery(`✅ Stavkangiz qabul qilindi: ${amount} RWcoin!`);
  if (result.previousBidderId) {
    try {
      await ctx.telegram.sendMessage(
        result.previousBidderId,
        `⚠️ Sizning auksiondagi stavkangiz (${result.previousBid} RWcoin) oshirib yuborildi. Diqqat: qoidaga ko'ra bu RWcoin qaytarilmaydi - xohlasangiz qayta stavka qo'ying!`
      );
    } catch (err) {
      // foydalanuvchi botni bloklagan bo'lishi mumkin
    }
  }
  try {
    const me = await ctx.telegram.getMe();
    await ctx.editMessageText(
      renderChannelAuctionText(result.auction),
      { parse_mode: 'HTML', ...channelAuctionInline(result.auction, me.username) }
    );
  } catch (err) {
    // xabar o'zgarmagan yoki tahrirlab bo'lmaydi - e'tiborsiz qoldiramiz
  }
  // Garov oshirilganini kanalga alohida xabar sifatida ham e'lon qilamiz
  if (config.auctionChannelId) {
    try {
      await ctx.telegram.sendMessage(
        config.auctionChannelId,
        `⭐️ <a href="tg://user?id=${ctx.from.id}">${escapeHtml(getFullName(ctx.from))}</a> garovni ${amount} RWcoinga oshirdi!`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      // kanalga yozib bo'lmadi - e'tiborsiz qoldiramiz
    }
  }
});

async function showSettings(ctx) {
  await ctx.reply(
    '⚙️ Sozlamalar\n\nHozircha shaxsiy sozlamalar mavjud emas. Botlaringizni "📂 Mening botlarim" bo\'limidan boshqarishingiz mumkin.',
    backToMainMenuInline()
  );
}
bot.hears('⚙️ Sozlamalar', showSettings);
bot.action('menu_settings', async (ctx) => {
  await ctx.answerCbQuery();
  return showSettings(ctx);
});

async function showHelp(ctx) {
  await ctx.reply(
    '🆘 Yordam\n\n' +
      '🤖 Bot yaratish — RWcoin evaziga @BotFather orqali olingan token yordamida yangi bot yaratasiz.\n' +
      '📂 Mening botlarim — botlaringizni boshqarasiz (ishga tushirish/to\'xtatish/o\'chirish).\n' +
      '👥 Referallar — do\'stlaringizni taklif qilib RWcoin yig\'asiz.\n' +
      '💰 RWcoin — balansingiz va RWcoin yig\'ish yo\'llari.\n' +
      '🏆 Auksion — stavka qo\'yib RWcoiningizni ko\'paytirasiz.\n' +
      '📊 Profil — hisobingiz haqida ma\'lumot.\n\n' +
      'Savollar bo\'lsa, administratorga murojaat qiling.',
    Markup.inlineKeyboard([
      [Markup.button.url('👨‍💻 Admin dasturchi', `https://t.me/${config.developerUsername}`)],
      [Markup.button.url('🏆 RW Auksion kanali', `https://t.me/${config.auctionChannelUsername}`)],
      [Markup.button.url('📰 RW Builder News', `https://t.me/${config.builderNewsChannelUsername}`)],
      [Markup.button.callback('⬅️ Asosiy menyu', 'menu_back')],
    ])
  );
}
bot.hears('🆘 Yordam', showHelp);
bot.action('menu_help', async (ctx) => {
  await ctx.answerCbQuery();
  return showHelp(ctx);
});

// ===================== ADMIN PANEL =====================

bot.hears('👨‍💻 Admin', adminOnlyMiddleware(), admin.openAdminPanel);
bot.command('admin', adminOnlyMiddleware(), admin.openAdminPanel);
bot.action('menu_admin', adminOnlyMiddleware(), async (ctx) => {
  await ctx.answerCbQuery();
  return admin.openAdminPanel(ctx);
});

bot.hears('⬅️ Asosiy menyu', async (ctx) => ctx.reply('Asosiy menyu:', mainMenuInline(await isAdminUser(ctx.from.id))));
bot.action('menu_back', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply('Asosiy menyu:', mainMenuInline(await isAdminUser(ctx.from.id)));
});

bot.hears('👥 Foydalanuvchilar', adminOnlyMiddleware(), async (ctx) => admin.showUsers(ctx, 1));
bot.action(/usersPage_(\d+)/, adminOnlyMiddleware(), async (ctx) => admin.showUsers(ctx, Number(ctx.match[1])));
bot.hears('🤖 Botlar', adminOnlyMiddleware(), admin.showAllBots);
bot.hears('📢 Kanallar', adminOnlyMiddleware(), admin.showChannels);
bot.action(/delchannel_(.+)/, adminOnlyMiddleware(), async (ctx) => {
  return admin.handleDeleteChannel(ctx, ctx.match[1]);
});
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
bot.hears('💵 Shablon narxlari', adminOnlyMiddleware(), admin.showTemplatePrices);
bot.hears('🏆 Auksion yaratish', adminOnlyMiddleware(), admin.startAuctionCreation);
bot.hears('💰 RWcoin sozlamalari', adminOnlyMiddleware(), admin.showRwcoinSettings);

bot.action(/setprice_(.+)/, adminOnlyMiddleware(), (ctx) => admin.promptTemplatePrice(ctx, ctx.match[1]));

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
      case 'awaiting_rwcoin_per_referral':
        return admin.handleRwcoinPerReferralInput(ctx);
      case 'awaiting_template_price':
        return admin.handleTemplatePriceInput(ctx);
      case 'awaiting_auction_title':
      case 'awaiting_auction_description':
      case 'awaiting_auction_min_bid':
      case 'awaiting_auction_duration':
        return admin.handleAuctionCreationInput(ctx);
      case 'awaiting_broadcast_content':
        return admin.handleBroadcastContent(ctx);
      case 'awaiting_broadcast_buttons':
        return admin.handleBroadcastButtonsAndConfirm(ctx);
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
      await ctx.reply('❌ Bekor qilindi.', mainMenuInline(await isAdminUser(ctx.from.id)));
      return;
    }
    const amount = parseInt(text, 10);
    if (Number.isNaN(amount) || amount < 1) {
      await ctx.reply('❌ Noto\'g\'ri miqdor. Musbat raqam kiriting.');
      return;
    }
    const result = await placeBid(auctionState.data.auctionId, ctx.from.id, amount, getFullName(ctx.from));
    clearState(AUCTION_SCOPE, ctx.from.id);
    if (!result.ok) {
      const messages = {
        not_found: '❌ Auksion topilmadi.',
        ended: '❌ Auksion allaqachon tugagan.',
        too_low: `❌ Stavka juda kichik. Minimal: ${result.minRequired || ''}`,
        too_high: `❌ Bir martada ko'pi bilan ${MAX_BID_STEP} RWcoinga oshirish mumkin.`,
        already_leading: '⚠️ Siz allaqachon yetakchisiz, ketma-ket ikki marta stavka qo\'ya olmaysiz.',
        no_rwcoin: '❌ RWcoiningiz yetarli emas.',
        race_condition: '❌ Boshqa foydalanuvchi ayni damda stavka qo\'ydi, qaytadan urinib ko\'ring.',
      };
      await ctx.reply(messages[result.reason] || '❌ Xatolik yuz berdi.');
      return;
    }
    await ctx.reply(`✅ Stavkangiz qabul qilindi: ${amount} RWcoin! Hozircha yetakchisiz.`);
    if (result.previousBidderId) {
      try {
        await ctx.telegram.sendMessage(
          result.previousBidderId,
          `⚠️ Sizning auksiondagi stavkangiz (${result.previousBid} RWcoin) oshirib yuborildi. Diqqat: bu RWcoin qaytarilmaydi - xohlasangiz qayta stavka qo'ying!`
        );
      } catch (err) {
        // foydalanuvchi botni bloklagan bo'lishi mumkin
      }
    }
    if (config.auctionChannelId) {
      if (result.auction.channelMessageId) {
        try {
          const me = await ctx.telegram.getMe();
          await ctx.telegram.editMessageText(
            config.auctionChannelId,
            result.auction.channelMessageId,
            undefined,
            renderChannelAuctionText(result.auction),
            { parse_mode: 'HTML', ...channelAuctionInline(result.auction, me.username) }
          );
        } catch (err) {
          // xabar o'zgarmagan yoki tahrirlab bo'lmaydi - e'tiborsiz qoldiramiz
        }
      }
      try {
        await ctx.telegram.sendMessage(
          config.auctionChannelId,
          `⭐️ <a href="tg://user?id=${ctx.from.id}">${escapeHtml(getFullName(ctx.from))}</a> garovni ${amount} RWcoinga oshirdi!`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        // kanalga yozib bo'lmadi - e'tiborsiz qoldiramiz
      }
    }
    return;
  }

  // Foydalanuvchi o'z auksionini boshlash uchun garov miqdorini kiritmoqda
  const userAuctionState = getState(USER_AUCTION_SCOPE, ctx.from.id);
  if (userAuctionState && userAuctionState.step === 'awaiting_own_garov') {
    const text = (ctx.message.text || '').trim();
    if (text === '❌ Bekor qilish') {
      clearState(USER_AUCTION_SCOPE, ctx.from.id);
      await ctx.reply('❌ Bekor qilindi.', mainMenuInline(await isAdminUser(ctx.from.id)));
      return;
    }
    const garov = parseInt(text, 10);
    if (Number.isNaN(garov) || garov < MIN_USER_AUCTION_BID) {
      await ctx.reply(`❌ Noto'g'ri miqdor. Kamida ${MIN_USER_AUCTION_BID} RWcoin kiriting.`);
      return;
    }
    clearState(USER_AUCTION_SCOPE, ctx.from.id);
    try {
      const auction = await createAuction({
        title: `${ctx.from.first_name || 'Foydalanuvchi'} auksioni`,
        description: '',
        minBid: MIN_USER_AUCTION_BID,
        durationMinutes: USER_AUCTION_DURATION_MINUTES,
        createdBy: ctx.from.id,
        startBid: garov,
        createdByName: getFullName(ctx.from),
      });
      await ctx.reply(
        `✅ Auksioningiz boshlandi!\n\n⭐ Garov: ${garov} RWcoin\n⏱ Boshlang'ich vaqt: ${BID_EXTENSION_MINUTES} daqiqa (har garovdan so'ng yana shuncha uzayadi)\n\n` +
          `${config.auctionChannelId ? 'Auksion kanalga e\'lon qilindi.' : 'Auksion "🏆 Auksion" bo\'limida ko\'rinadi.'}`,
        mainMenuInline(await isAdminUser(ctx.from.id))
      );
      await postAuctionToChannel(ctx, auction);
    } catch (err) {
      logger.warn({ err: err.message }, 'Foydalanuvchi auksionini yaratishda xatolik');
      await ctx.reply('❌ RWcoiningiz yetarli emas yoki xatolik yuz berdi.', mainMenuInline(await isAdminUser(ctx.from.id)));
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

module.exports = bot;
