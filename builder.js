const { setState, getState, updateStateData, clearState } = require('./states');
const { isValidBotToken, isValidBotName, isValidDescription, sanitizeText } = require('./security');
const { createBot, startBot, verifyTokenWithTelegram } = require('./botmanager');
const { getUserByTelegramId, consumeFreeBotCredit, spendCoins } = require('./users');
const { getReferralInfo } = require('./referral');
const { getBotPriceCoins } = require('./settings');
const { listChannels, checkUserSubscription } = require('./subscription');
const { templateSelectionInline, referralShareInline, cancelKeyboard, mainMenu } = require('./buttons');
const { getTemplateList } = require('./templates');
const { Bot } = require('./database');
const logger = require('./logger');

const SCOPE = 'builder';

async function canCreateBot(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { allowed: false, reason: 'Foydalanuvchi topilmadi' };
  const botPrice = await getBotPriceCoins();
  if (user.freeBotCredits >= 1) {
    return { allowed: true, user, payWith: 'credit' };
  }
  if (user.coins >= botPrice) {
    return { allowed: true, user, payWith: 'coins', botPrice };
  }
  return { allowed: false, reason: 'no_credits', botPrice };
}

async function replyNeedReferral(ctx, botPrice) {
  const me = await ctx.telegram.getMe();
  const info = await getReferralInfo(ctx.from.id, me.username);
  const remaining = info ? info.remaining || info.required : '?';
  const price = botPrice || (info ? undefined : undefined);
  await ctx.reply(
    `❌ Bot yaratish uchun sizda yetarli referal krediti yoki koin yo'q.\n\n` +
      `👥 Do'stlaringizni taklif qiling: yana ${remaining} ta referal to'plasangiz, bepul bot yaratish huquqiga ega bo'lasiz.\n` +
      `🪙 Yoki koin to'plab, ${price || ''} koinga bot sotib olishingiz mumkin (hozirgi koiningiz: ${info ? info.coins : 0}).\n\n` +
      `🔗 Sizning referal havolangiz:\n${info ? info.link : '-'}`,
    info ? referralShareInline(info.link, '🤖 Bepul Telegram bot yaratish uchun shu havoladan foydalaning!') : undefined
  );
}

// Bot yaratish endi shu tartibda ishlaydi:
// 1) Avval mavjud shablonlar (botlar turi) ro'yxati ko'rsatiladi
// 2) Foydalanuvchi biror shablonni tanlaganda referal talabi tekshiriladi -
//    yetarli bo'lmasa referal taklif qilinadi, yetarli bo'lsa token so'raladi
async function startBotCreation(ctx) {
  setState(SCOPE, ctx.from.id, 'awaiting_template', {});
  return ctx.reply(
    '🤖 Yangi bot yaratish\n\nQuyidagi mavjud bot turlaridan birini tanlang:',
    templateSelectionInline(getTemplateList())
  );
}

async function handleBuilderText(ctx) {
  const state = getState(SCOPE, ctx.from.id);
  if (!state) return false;

  const text = sanitizeText(ctx.message.text || '');

  if (text === '❌ Bekor qilish') {
    clearState(SCOPE, ctx.from.id);
    await ctx.reply('❌ Bot yaratish bekor qilindi.', mainMenu);
    return true;
  }

  switch (state.step) {
    case 'awaiting_token': {
      if (!isValidBotToken(text)) {
        await ctx.reply('❌ Token formati noto\'g\'ri. Qaytadan yuboring yoki bekor qiling.');
        return true;
      }
      await ctx.reply('⏳ Token tekshirilmoqda...');
      const verification = await verifyTokenWithTelegram(text);
      if (!verification.valid) {
        await ctx.reply(`❌ Token yaroqsiz: ${verification.error}\nQaytadan urinib ko'ring.`);
        return true;
      }
      const existing = await Bot.findOne({ botUsername: verification.me.username });
      if (existing) {
        await ctx.reply('❌ Bu token bilan bot allaqachon ro\'yxatdan o\'tgan.');
        return true;
      }
      updateStateData(SCOPE, ctx.from.id, { token: text, suggestedName: verification.me.first_name });
      setState(SCOPE, ctx.from.id, 'awaiting_name');
      await ctx.reply(
        `✅ Token tasdiqlandi: @${verification.me.username}\n\nEndi bot uchun nom kiriting (masalan: "Mening do'konim"):`
      );
      return true;
    }

    case 'awaiting_name': {
      if (!isValidBotName(text)) {
        await ctx.reply('❌ Nom 2-64 belgidan iborat bo\'lishi kerak. Qaytadan kiriting.');
        return true;
      }
      updateStateData(SCOPE, ctx.from.id, { botName: text });
      setState(SCOPE, ctx.from.id, 'awaiting_description');
      await ctx.reply('📝 Endi bot uchun qisqacha tavsif kiriting (yoki "-" yuboring, tavsifsiz qoldirish uchun):');
      return true;
    }

    case 'awaiting_description': {
      const description = text === '-' ? '' : text;
      if (!isValidDescription(description)) {
        await ctx.reply('❌ Tavsif juda uzun (maksimal 512 belgi). Qaytadan kiriting.');
        return true;
      }
      updateStateData(SCOPE, ctx.from.id, { description });
      return finalizeBotCreation(ctx);
    }

    default:
      return false;
  }
}

async function handleTemplateSelection(ctx) {
  const state = getState(SCOPE, ctx.from.id);
  if (!state || state.step !== 'awaiting_template') {
    return ctx.answerCbQuery('Sessiya eskirgan, qaytadan boshlang.');
  }

  const templateType = ctx.match[1];
  await ctx.answerCbQuery();

  const check = await canCreateBot(ctx.from.id);
  if (!check.allowed) {
    clearState(SCOPE, ctx.from.id);
    if (check.reason === 'no_credits') {
      return replyNeedReferral(ctx, check.botPrice);
    }
    return ctx.reply('❌ Xatolik: ' + check.reason);
  }

  updateStateData(SCOPE, ctx.from.id, { templateType });
  setState(SCOPE, ctx.from.id, 'awaiting_token');
  await ctx.editMessageText(
    `📦 Tanlangan tur: ${templateType}\n\n✅ Sizda bot yaratish huquqi bor! (${
      check.payWith === 'coins' ? `🪙 ${check.botPrice} koin hisobidan yechiladi` : '🎁 bepul kredit hisobidan'
    })`
  );
  await ctx.reply(
    '1️⃣ Avval @BotFather orqali yangi bot yarating.\n' +
      '2️⃣ Undan olingan tokenni shu yerga yuboring.\n\n' +
      'Masalan: 123456789:AAExampleToken...',
    cancelKeyboard
  );
}

async function finalizeBotCreation(ctx) {
  const state = getState(SCOPE, ctx.from.id);

  // Navbatdagi bosqichlar davomida kredit/koin boshqa joyda sarflanmaganini yana bir bor tekshiramiz
  const check = await canCreateBot(ctx.from.id);
  if (!check.allowed) {
    clearState(SCOPE, ctx.from.id);
    if (check.reason === 'no_credits') {
      return replyNeedReferral(ctx, check.botPrice);
    }
    return ctx.reply('❌ Xatolik: ' + check.reason);
  }

  try {
    const botDoc = await createBot({
      ownerId: ctx.from.id,
      token: state.data.token,
      botName: state.data.botName,
      description: state.data.description,
      templateType: state.data.templateType,
    });

    if (check.payWith === 'coins') {
      const spent = await spendCoins(ctx.from.id, check.botPrice);
      if (!spent) {
        // Musobaqa holati: koin boshqa joyda sarflab bo'lingan, botni ham bekor qilamiz
        await Bot.deleteOne({ _id: botDoc._id });
        clearState(SCOPE, ctx.from.id);
        return replyNeedReferral(ctx, check.botPrice);
      }
    } else {
      await consumeFreeBotCredit(ctx.from.id);
    }

    await startBot(botDoc);

    clearState(SCOPE, ctx.from.id);

    await ctx.reply(
      `🎉 Bot muvaffaqiyatli yaratildi va ishga tushirildi!\n\n` +
        `🤖 Nomi: ${botDoc.botName}\n` +
        `🔗 Username: @${botDoc.botUsername}\n` +
        `📦 Turi: ${state.data.templateType}\n` +
        `💳 To'lov: ${check.payWith === 'coins' ? `${check.botPrice} koin` : '1 bepul kredit'}\n\n` +
        `Botni "📂 Mening botlarim" bo'limidan boshqarishingiz mumkin.`,
      mainMenu
    );
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Bot yaratishda xatolik');
    clearState(SCOPE, ctx.from.id);
    await ctx.reply(`❌ Bot yaratishda xatolik yuz berdi: ${err.message}`, mainMenu);
    return true;
  }
}

module.exports = {
  startBotCreation,
  handleBuilderText,
  handleTemplateSelection,
};
