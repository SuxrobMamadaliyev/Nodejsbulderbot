const { Bot, Channel, Log, Admin } = require('./database');
const { setState, getState, updateStateData, clearState } = require('./states');
const { adminMenu, mainMenu, cancelKeyboard, botListInline, botManageInline, confirmInline } = require('./buttons');
const { getUsersPaginated, searchUser, blockUser, unblockUser } = require('./users');
const { addChannel, removeChannel, listChannels, resolveChannelChatId } = require('./subscription');
const {
  getReferralRequired,
  setReferralRequired,
  getCoinsPerReferral,
  setCoinsPerReferral,
  getBotPriceCoins,
  setBotPriceCoins,
} = require('./settings');
const { getOverallStatistics, formatOverallStatistics } = require('./statistics');
const { buildPayloadFromMessage, runBroadcast } = require('./broadcast');
const { startBot, stopBot, restartBot, deleteBot, getBotInfo } = require('./botmanager');
const { isValidChannelInput, sanitizeText } = require('./security');
const { formatDate } = require('./functions');
const { registerCustomTemplateFromCode, getTemplateList } = require('./templates');
const { createAuction, cancelAuction, getActiveAuctions } = require('./auction');
const logger = require('./logger');

const MAX_TEMPLATE_FILE_SIZE = 512 * 1024; // 512 KB

const SCOPE = 'admin';

async function openAdminPanel(ctx) {
  return ctx.reply('⚙️ Admin panelga xush kelibsiz.', adminMenu);
}

// ===================== FOYDALANUVCHILAR =====================

async function showUsers(ctx, page = 1) {
  const { items, totalPages } = await getUsersPaginated(page, 8);
  if (!items.length) return ctx.reply('👥 Foydalanuvchilar topilmadi.');

  const lines = items.map(
    (u, i) =>
      `${(page - 1) * 8 + i + 1}. ${u.telegramId} ${u.username ? '@' + u.username : ''} ${
        u.isBlocked ? '🚫' : '✅'
      } | Ref: ${u.referralsCount}`
  );

  await ctx.reply(`👥 Foydalanuvchilar (${page}/${totalPages}):\n\n${lines.join('\n')}`);
}

async function handleUserSearch(ctx) {
  setState(SCOPE, ctx.from.id, 'awaiting_user_search', {});
  return ctx.reply('🔎 Foydalanuvchi ID yoki @username kiriting:', cancelKeyboard);
}

async function resolveUserSearch(ctx, query) {
  const user = await searchUser(query);
  if (!user) return ctx.reply('❌ Foydalanuvchi topilmadi.', adminMenu);

  const botsCount = await Bot.countDocuments({ ownerId: user.telegramId });
  await ctx.reply(
    `👤 Foydalanuvchi ma'lumotlari\n\n` +
      `🆔 ID: ${user.telegramId}\n` +
      `Username: ${user.username ? '@' + user.username : 'yo\'q'}\n` +
      `Holat: ${user.isBlocked ? '🚫 Bloklangan' : '✅ Faol'}\n` +
      `🤖 Botlar: ${botsCount}\n` +
      `👥 Referallar: ${user.referralsCount}\n` +
      `🎁 Kreditlar: ${user.freeBotCredits}\n` +
      `📅 Ro'yxatdan o'tgan: ${formatDate(user.createdAt)}`,
    confirmInline(`blockuser_${user.telegramId}`, `unblockuser_${user.telegramId}`)
  );
}

async function toggleBlockUser(ctx, telegramId, block) {
  if (block) await blockUser(telegramId);
  else await unblockUser(telegramId);
  await ctx.answerCbQuery(block ? '🚫 Bloklandi' : '✅ Blokdan chiqarildi');
  await ctx.editMessageText(`Foydalanuvchi ${telegramId} holati: ${block ? '🚫 Bloklangan' : '✅ Faol'}`);
}

// ===================== BOTLAR =====================

async function showAllBots(ctx) {
  const bots = await Bot.find().sort({ createdAt: -1 }).limit(30);
  if (!bots.length) return ctx.reply('🤖 Hali botlar yaratilmagan.');
  await ctx.reply(`🤖 Botlar ro'yxati (${bots.length}):`, botListInline(bots));
}

async function showBotDetail(ctx, botId) {
  try {
    const { doc, isRunning } = await getBotInfo(botId);
    await ctx.editMessageText(
      `🤖 ${doc.botName}\n` +
        `🔗 @${doc.botUsername}\n` +
        `👤 Owner: ${doc.ownerId}\n` +
        `📦 Shablon: ${doc.templateType}\n` +
        `Holat: ${isRunning ? '🟢 Faol' : '🔴 To\'xtatilgan'}\n` +
        `💬 Xabarlar: ${doc.stats?.totalMessages || 0}\n` +
        `📅 Yaratilgan: ${formatDate(doc.createdAt)}`,
      botManageInline(doc._id.toString(), isRunning ? 'active' : 'stopped')
    );
  } catch (err) {
    await ctx.answerCbQuery('Xatolik: ' + err.message, { show_alert: true });
  }
}

// ===================== KANALLAR =====================

async function showChannels(ctx) {
  const channels = await listChannels({ scope: 'master' });
  if (!channels.length) {
    return ctx.reply('📢 Majburiy obuna kanallari hali qo\'shilmagan.\n\nQo\'shish uchun kanal @username yoki ID yuboring.', cancelKeyboard);
  }
  const lines = channels.map((c, i) => `${i + 1}. ${c.title} (${c.username || c.chatId})`);
  await ctx.reply(
    `📢 Majburiy obuna kanallari:\n\n${lines.join('\n')}\n\nYangi kanal qo'shish uchun @username yoki ID yuboring.`,
    cancelKeyboard
  );
}

async function handleAddChannel(ctx, telegram) {
  const text = sanitizeText(ctx.message.text || '');
  if (!isValidChannelInput(text)) {
    return ctx.reply('❌ Noto\'g\'ri format. @username yoki -100... ID yuboring.');
  }
  try {
    const resolved = await resolveChannelChatId(telegram, text);
    await addChannel({ scope: 'master', chatId: resolved.chatId, title: resolved.title, username: resolved.username, inviteLink: resolved.inviteLink, addedBy: ctx.from.id });
    await ctx.reply(`✅ Kanal qo'shildi: ${resolved.title}`, adminMenu);
  } catch (err) {
    logger.warn({ err: err.message }, 'Kanal qo\'shishda xatolik');
    await ctx.reply('❌ Kanalni topib bo\'lmadi. Bot kanalga admin qilib qo\'shilganini tekshiring.');
  }
}

// ===================== BROADCAST =====================

async function startBroadcastFlow(ctx) {
  setState(SCOPE, ctx.from.id, 'awaiting_broadcast_content', {});
  return ctx.reply(
    '📤 Yubormoqchi bo\'lgan xabaringizni yuboring (matn, rasm, video, audio, voice, gif, sticker yoki fayl):',
    cancelKeyboard
  );
}

async function handleBroadcastContent(ctx) {
  updateStateData(SCOPE, ctx.from.id, { message: ctx.message });
  setState(SCOPE, ctx.from.id, 'awaiting_broadcast_buttons');
  return ctx.reply(
    'Inline tugmalar qo\'shmoqchimisiz? Format:\n"Matn - https://link"\nBir qatorda bir nechta tugma uchun "|" bilan ajrating.\n\nAgar tugma kerak bo\'lmasa "-" yuboring.'
  );
}

async function handleBroadcastButtonsAndConfirm(ctx) {
  const state = getState(SCOPE, ctx.from.id);
  const text = sanitizeText(ctx.message.text || '');
  const buttonsRaw = text === '-' ? null : text;
  updateStateData(SCOPE, ctx.from.id, { buttonsRaw });
  setState(SCOPE, ctx.from.id, 'confirming_broadcast');
  await ctx.reply(
    '📤 Xabarni barcha foydalanuvchilarga yuborishni tasdiqlaysizmi?',
    confirmInline('broadcast_confirm', 'broadcast_cancel')
  );
}

async function executeBroadcast(ctx) {
  const state = getState(SCOPE, ctx.from.id);
  if (!state || !state.data.message) {
    return ctx.answerCbQuery('Sessiya topilmadi', { show_alert: true });
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText('⏳ Yuborilmoqda, iltimos kuting...');

  try {
    const payload = buildPayloadFromMessage(state.data.message, state.data.buttonsRaw);
    const result = await runBroadcast(ctx.telegram, payload);
    clearState(SCOPE, ctx.from.id);
    await ctx.reply(
      `✅ Broadcast yakunlandi!\n\n📤 Yuborildi: ${result.sent}\n❌ Xatolik: ${result.failed}\n👥 Jami: ${result.total}`,
      adminMenu
    );
  } catch (err) {
    clearState(SCOPE, ctx.from.id);
    await ctx.reply('❌ Xatolik: ' + err.message, adminMenu);
  }
}

// ===================== SOZLAMALAR (referal soni) =====================

async function showAdminSettings(ctx) {
  const required = await getReferralRequired();
  setState(SCOPE, ctx.from.id, 'awaiting_referral_count', {});
  await ctx.reply(
    `⚙️ Hozirgi referal talabi: ${required} ta referal = 1 ta bot.\n\nYangi qiymat kiriting (faqat raqam):`,
    cancelKeyboard
  );
}

async function handleReferralCountInput(ctx) {
  const text = sanitizeText(ctx.message.text || '');
  const num = parseInt(text, 10);
  if (Number.isNaN(num) || num < 1) {
    return ctx.reply('❌ Noto\'g\'ri qiymat. Musbat raqam kiriting.');
  }
  await setReferralRequired(num);
  clearState(SCOPE, ctx.from.id);
  await ctx.reply(`✅ Referal talabi yangilandi: ${num} ta referal = 1 ta bot.`, adminMenu);
}

// ===================== KOIN SOZLAMALARI =====================

async function showCoinSettings(ctx) {
  const coinsPerReferral = await getCoinsPerReferral();
  const botPrice = await getBotPriceCoins();
  setState(SCOPE, ctx.from.id, 'awaiting_coins_per_referral', {});
  await ctx.reply(
    `🪙 Koin sozlamalari\n\n` +
      `Hozirgi: 1 referal = ${coinsPerReferral} koin\n` +
      `Bot narxi: ${botPrice} koin\n\n` +
      `Yangi "1 referal uchun koin" qiymatini kiriting (faqat raqam):`,
    cancelKeyboard
  );
}

async function handleCoinsPerReferralInput(ctx) {
  const text = sanitizeText(ctx.message.text || '');
  const num = parseInt(text, 10);
  if (Number.isNaN(num) || num < 0) {
    return ctx.reply('❌ Noto\'g\'ri qiymat. 0 yoki musbat raqam kiriting.');
  }
  await setCoinsPerReferral(num);
  setState(SCOPE, ctx.from.id, 'awaiting_bot_price_coins', {});
  await ctx.reply(`✅ Har bir referal uchun endi ${num} koin beriladi.\n\nEndi bot narxini (koinda) kiriting:`);
}

async function handleBotPriceCoinsInput(ctx) {
  const text = sanitizeText(ctx.message.text || '');
  const num = parseInt(text, 10);
  if (Number.isNaN(num) || num < 1) {
    return ctx.reply('❌ Noto\'g\'ri qiymat. Musbat raqam kiriting.');
  }
  await setBotPriceCoins(num);
  clearState(SCOPE, ctx.from.id);
  await ctx.reply(`✅ Bot narxi yangilandi: ${num} koin.`, adminMenu);
}

// ===================== AUKSION YARATISH (ADMIN) =====================
// Bosqichlar: sarlavha -> tavsif -> minimal stavka -> bonus (pot) koin -> davomiylik (daqiqa)

async function startAuctionCreation(ctx) {
  setState(SCOPE, ctx.from.id, 'awaiting_auction_title', {});
  await ctx.reply('🏆 Yangi koin auksioni yaratish\n\nAuksion sarlavhasini kiriting:', cancelKeyboard);
}

async function handleAuctionCreationInput(ctx) {
  const state = getState(SCOPE, ctx.from.id);
  if (!state) return false;
  const text = sanitizeText(ctx.message.text || '');

  switch (state.step) {
    case 'awaiting_auction_title': {
      if (!text || text.length > 128) {
        await ctx.reply('❌ Sarlavha 1-128 belgidan iborat bo\'lishi kerak.');
        return true;
      }
      updateStateData(SCOPE, ctx.from.id, { title: text });
      setState(SCOPE, ctx.from.id, 'awaiting_auction_description');
      await ctx.reply('📝 Auksion tavsifini kiriting (yoki "-" tavsifsiz qoldirish uchun):');
      return true;
    }
    case 'awaiting_auction_description': {
      updateStateData(SCOPE, ctx.from.id, { description: text === '-' ? '' : text });
      setState(SCOPE, ctx.from.id, 'awaiting_auction_min_bid');
      await ctx.reply('🪙 Minimal stavka miqdorini kiriting (koinda, faqat raqam):');
      return true;
    }
    case 'awaiting_auction_min_bid': {
      const minBid = parseInt(text, 10);
      if (Number.isNaN(minBid) || minBid < 1) {
        await ctx.reply('❌ Noto\'g\'ri qiymat. Musbat raqam kiriting.');
        return true;
      }
      updateStateData(SCOPE, ctx.from.id, { minBid });
      setState(SCOPE, ctx.from.id, 'awaiting_auction_pot');
      await ctx.reply("🎁 G'olibga beriladigan bonus koin miqdorini kiriting:");
      return true;
    }
    case 'awaiting_auction_pot': {
      const potCoins = parseInt(text, 10);
      if (Number.isNaN(potCoins) || potCoins < 1) {
        await ctx.reply('❌ Noto\'g\'ri qiymat. Musbat raqam kiriting.');
        return true;
      }
      updateStateData(SCOPE, ctx.from.id, { potCoins });
      setState(SCOPE, ctx.from.id, 'awaiting_auction_duration');
      await ctx.reply('⏱ Auksion necha daqiqa davom etsin?');
      return true;
    }
    case 'awaiting_auction_duration': {
      const durationMinutes = parseInt(text, 10);
      if (Number.isNaN(durationMinutes) || durationMinutes < 1) {
        await ctx.reply('❌ Noto\'g\'ri qiymat. Musbat raqam kiriting.');
        return true;
      }
      const data = getState(SCOPE, ctx.from.id).data;
      try {
        const auction = await createAuction({
          title: data.title,
          description: data.description,
          minBid: data.minBid,
          potCoins: data.potCoins,
          durationMinutes,
          createdBy: ctx.from.id,
        });
        clearState(SCOPE, ctx.from.id);
        await ctx.reply(
          `✅ Auksion yaratildi!\n\n` +
            `🏆 ${auction.title}\n` +
            `🪙 Minimal stavka: ${auction.minBid}\n` +
            `🎁 Bonus: ${auction.potCoins} koin\n` +
            `⏱ Tugash vaqti: ${formatDate(auction.endsAt)}\n\n` +
            `Foydalanuvchilar "🏆 Auksion" bo'limidan ishtirok etishlari mumkin.`,
          adminMenu
        );
      } catch (err) {
        logger.error({ err: err.message }, 'Auksion yaratishda xatolik');
        clearState(SCOPE, ctx.from.id);
        await ctx.reply('❌ Auksion yaratishda xatolik yuz berdi: ' + err.message, adminMenu);
      }
      return true;
    }
    default:
      return false;
  }
}

// ===================== MAXSUS SHABLON YUKLASH =====================
// Admin tayyor .js kod faylini yuborsa, u tekshirilib, shablonlar ro'yxatiga
// (va shu orqali "Bot yaratish -> Shablon tanlash" botlar qatoriga) qo'shiladi.

async function showTemplateUploadPrompt(ctx) {
  const templates = getTemplateList();
  const lines = templates.map((t) => `• ${t.name} (${t.key})`);
  setState(SCOPE, ctx.from.id, 'awaiting_template_file', {});
  await ctx.reply(
    `🧩 Maxsus shablon yuklash\n\n` +
      `Hozirgi shablonlar:\n${lines.join('\n')}\n\n` +
      `Yangi shablon qo'shish uchun .js fayl yuboring. Fayl quyidagi ko'rinishda bo'lishi kerak:\n\n` +
      '```\n' +
      "module.exports = {\n" +
      "  name: 'Mening shablonim',\n" +
      "  description: 'Qisqacha tavsif',\n" +
      "  register(bot, botDoc) {\n" +
      "    bot.start((ctx) => ctx.reply('Salom!'));\n" +
      "  },\n" +
      "};\n" +
      '```\n\n' +
      "Fayl muvaffaqiyatli tekshirilsa, u avtomatik ravishda botlar qatoriga (shablonlar ro'yxatiga) qo'shiladi.",
    cancelKeyboard
  );
}

async function handleTemplateFileUpload(ctx) {
  const doc = ctx.message.document;
  if (!doc) {
    return ctx.reply('❌ Iltimos, .js fayl yuboring.');
  }
  if (!/\.js$/i.test(doc.file_name || '')) {
    return ctx.reply('❌ Fayl kengaytmasi .js bo\'lishi kerak.');
  }
  if (doc.file_size && doc.file_size > MAX_TEMPLATE_FILE_SIZE) {
    return ctx.reply('❌ Fayl hajmi juda katta (maksimal 512 KB).');
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const axios = require('axios');
    const response = await axios.get(fileLink.href, { responseType: 'text', transformResponse: (d) => d });
    const code = response.data;

    const key = (doc.file_name || `custom_${Date.now()}`).replace(/\.js$/i, '');
    const result = await registerCustomTemplateFromCode({
      key,
      code,
      fileName: doc.file_name,
      addedBy: ctx.from.id,
    });

    clearState(SCOPE, ctx.from.id);
    await ctx.reply(
      `✅ Shablon muvaffaqiyatli qo'shildi!\n\n` +
        `📦 Nomi: ${result.name}\n` +
        `🔑 Kaliti: ${result.key}\n\n` +
        `Endi foydalanuvchilar "🤖 Bot yaratish" bo'limida bu shablonni tanlashi mumkin.`,
      adminMenu
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Shablon yuklashda xatolik');
    await ctx.reply(
      `❌ Shablonni yuklab bo'lmadi: ${err.message}\n\nFayl formatini tekshirib, qaytadan yuboring yoki bekor qiling.`,
      cancelKeyboard
    );
  }
}

// ===================== LOGLAR =====================

async function showRecentLogs(ctx) {
  const logs = await Log.find().sort({ createdAt: -1 }).limit(15);
  if (!logs.length) return ctx.reply('📜 Loglar mavjud emas.');
  const lines = logs.map((l) => `[${formatDate(l.createdAt)}] ${l.level.toUpperCase()}: ${l.message}`);
  await ctx.reply(`📜 So'nggi loglar:\n\n${lines.join('\n')}`);
}

// ===================== BOT AMALLARI (inline callbacklar) =====================

async function handleBotAction(ctx, action, botId) {
  try {
    if (action === 'start') {
      await startBot(botId);
      await ctx.answerCbQuery('✅ Bot ishga tushirildi');
    } else if (action === 'stop') {
      await stopBot(botId);
      await ctx.answerCbQuery('⏹ Bot to\'xtatildi');
    } else if (action === 'restart') {
      await restartBot(botId);
      await ctx.answerCbQuery('🔄 Bot qayta ishga tushirildi');
    } else if (action === 'delete') {
      await deleteBot(botId);
      await ctx.answerCbQuery('🗑 Bot o\'chirildi');
      return ctx.editMessageText('🗑 Bot butunlay o\'chirildi.');
    }
    return showBotDetail(ctx, botId);
  } catch (err) {
    await ctx.answerCbQuery('Xatolik: ' + err.message, { show_alert: true });
  }
}

module.exports = {
  openAdminPanel,
  showUsers,
  handleUserSearch,
  resolveUserSearch,
  toggleBlockUser,
  showAllBots,
  showBotDetail,
  showChannels,
  handleAddChannel,
  startBroadcastFlow,
  handleBroadcastContent,
  handleBroadcastButtonsAndConfirm,
  executeBroadcast,
  showAdminSettings,
  handleReferralCountInput,
  showCoinSettings,
  handleCoinsPerReferralInput,
  handleBotPriceCoinsInput,
  startAuctionCreation,
  handleAuctionCreationInput,
  showTemplateUploadPrompt,
  handleTemplateFileUpload,
  showRecentLogs,
  handleBotAction,
  SCOPE,
};
