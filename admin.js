const { Bot, Channel, Log, Admin } = require('./database');
const { setState, getState, updateStateData, clearState } = require('./states');
const { adminMenu, mainMenu, cancelKeyboard, botListInline, botManageInline, confirmInline } = require('./buttons');
const { getUsersPaginated, searchUser, blockUser, unblockUser } = require('./users');
const { addChannel, removeChannel, listChannels, resolveChannelChatId } = require('./subscription');
const { getReferralRequired, setReferralRequired } = require('./settings');
const { getOverallStatistics, formatOverallStatistics } = require('./statistics');
const { buildPayloadFromMessage, runBroadcast } = require('./broadcast');
const { startBot, stopBot, restartBot, deleteBot, getBotInfo } = require('./botmanager');
const { isValidChannelInput, sanitizeText } = require('./security');
const { formatDate } = require('./functions');
const logger = require('./logger');

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
  showRecentLogs,
  handleBotAction,
  SCOPE,
};
