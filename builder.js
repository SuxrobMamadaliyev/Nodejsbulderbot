const { setState, getState, updateStateData, clearState } = require('./states');
const { isValidBotToken, isValidBotName, isValidDescription, sanitizeText } = require('./security');
const { createBot, startBot, verifyTokenWithTelegram } = require('./botmanager');
const { getUserByTelegramId, consumeFreeBotCredit } = require('./users');
const { listChannels, checkUserSubscription } = require('./subscription');
const { templateSelectionInline, cancelKeyboard, mainMenu } = require('./buttons');
const { Bot } = require('./database');
const logger = require('./logger');

const SCOPE = 'builder';

async function canCreateBot(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { allowed: false, reason: 'Foydalanuvchi topilmadi' };
  if (user.freeBotCredits < 1) {
    return { allowed: false, reason: 'no_credits' };
  }
  return { allowed: true, user };
}

async function startBotCreation(ctx) {
  const check = await canCreateBot(ctx.from.id);
  if (!check.allowed) {
    if (check.reason === 'no_credits') {
      return ctx.reply(
        '❌ Sizda bot yaratish uchun yetarli referal krediti yo\'q.\n' +
          '👥 Do\'stlaringizni taklif qiling va kerakli referal sonini to\'plang!\n' +
          'Referal holatini "👥 Referallar" bo\'limidan ko\'rishingiz mumkin.'
      );
    }
    return ctx.reply('❌ Xatolik: ' + check.reason);
  }

  setState(SCOPE, ctx.from.id, 'awaiting_token', {});
  return ctx.reply(
    '🤖 Yangi bot yaratish\n\n' +
      '1️⃣ Avval @BotFather orqali yangi bot yarating.\n' +
      '2️⃣ Undan olingan tokenni shu yerga yuboring.\n\n' +
      'Masalan: 123456789:AAExampleToken...',
    cancelKeyboard
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
      setState(SCOPE, ctx.from.id, 'awaiting_template');
      await ctx.reply('📦 Endi bot turini tanlang:', templateSelectionInline());
      return true;
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
    return ctx.reply('❌ Bot yaratish uchun kredit yetarli emas.');
  }

  try {
    const botDoc = await createBot({
      ownerId: ctx.from.id,
      token: state.data.token,
      botName: state.data.botName,
      description: state.data.description,
      templateType,
    });

    await consumeFreeBotCredit(ctx.from.id);
    await startBot(botDoc);

    clearState(SCOPE, ctx.from.id);

    await ctx.reply(
      `🎉 Bot muvaffaqiyatli yaratildi va ishga tushirildi!\n\n` +
        `🤖 Nomi: ${botDoc.botName}\n` +
        `🔗 Username: @${botDoc.botUsername}\n` +
        `📦 Turi: ${templateType}\n\n` +
        `Botni "📂 Mening botlarim" bo'limidan boshqarishingiz mumkin.`,
      mainMenu
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Bot yaratishda xatolik');
    clearState(SCOPE, ctx.from.id);
    await ctx.reply(`❌ Bot yaratishda xatolik yuz berdi: ${err.message}`, mainMenu);
  }
}

module.exports = {
  startBotCreation,
  handleBuilderText,
  handleTemplateSelection,
};
