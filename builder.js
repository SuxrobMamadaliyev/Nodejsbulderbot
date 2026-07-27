const { setState, getState, updateStateData, clearState } = require('./states');
const { isValidBotToken, isValidBotName, isValidDescription, sanitizeText } = require('./security');
const { createBot, startBot, verifyTokenWithTelegram } = require('./botmanager');
const { getUserByTelegramId, spendRwcoin } = require('./users');
const { getReferralInfo } = require('./referral');
const { getTemplatePrice, getTemplateList } = require('./templates');
const { templateSelectionInline, referralShareInline, cancelKeyboard, mainMenuInline } = require('./buttons');
const { isAdminUser } = require('./middlewares');
const { Bot } = require('./database');
const logger = require('./logger');

const SCOPE = 'builder';

// Botlar FAQAT RWcoin orqali sotib olinadi. Har bir shablonning o'z narxi bor
// (templates.js / Template kolleksiyasi orqali admin tomonidan belgilanadi).

async function replyNeedRwcoin(ctx, price) {
  const me = await ctx.telegram.getMe();
  const info = await getReferralInfo(ctx.from.id, me.username);
  await ctx.reply(
    `❌ Bu botni sotib olish uchun RWcoin yetarli emas.\n\n` +
      `💰 Kerak: ${price} RWcoin\n` +
      `🪙 Hozirgi balansingiz: ${info ? info.rwcoin : 0} RWcoin\n\n` +
      `👥 Do'stlaringizni taklif qiling: har bir referal uchun ${info ? info.rwcoinPerReferral : '-'} RWcoin olasiz.\n` +
      `🏆 Yoki "🏆 Auksion" bo'limida RWcoiningizni ko'paytirib olishingiz mumkin.\n\n` +
      `🔗 Sizning referal havolangiz:\n${info ? info.link : '-'}`,
    info ? referralShareInline(info.link, '🤖 Bot sotib olish uchun RWcoin yig\'ish - shu havoladan foydalaning!') : undefined
  );
}

// Bot yaratish shu tartibda ishlaydi:
// 1) Avval mavjud bot turlari (shablonlar) ro'yxati narxlari bilan ko'rsatiladi
// 2) Foydalanuvchi biror shablonni tanlaganda RWcoin balansi tekshiriladi -
//    yetarli bo'lmasa RWcoin yig'ish taklif qilinadi, yetarli bo'lsa token so'raladi
async function startBotCreation(ctx) {
  setState(SCOPE, ctx.from.id, 'awaiting_template', {});
  const templates = await getTemplateList();
  return ctx.reply(
    '🤖 Yangi bot yaratish\n\nQuyidagi mavjud bot turlaridan birini tanlang (narxlar RWcoinda ko\'rsatilgan):',
    templateSelectionInline(templates)
  );
}

async function handleBuilderText(ctx) {
  const state = getState(SCOPE, ctx.from.id);
  if (!state) return false;

  const text = sanitizeText(ctx.message.text || '');

  if (text === '❌ Bekor qilish') {
    clearState(SCOPE, ctx.from.id);
    await ctx.reply('❌ Bot yaratish bekor qilindi.', mainMenuInline(await isAdminUser(ctx.from.id)));
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

  const user = await getUserByTelegramId(ctx.from.id);
  const price = await getTemplatePrice(templateType);

  if (!user || user.rwcoin < price) {
    clearState(SCOPE, ctx.from.id);
    return replyNeedRwcoin(ctx, price);
  }

  updateStateData(SCOPE, ctx.from.id, { templateType, price });
  setState(SCOPE, ctx.from.id, 'awaiting_token');
  await ctx.editMessageText(
    `📦 Tanlangan tur: ${templateType}\n💰 Narxi: ${price} RWcoin\n\n✅ Balansingizda yetarli RWcoin bor!`
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
  const { templateType, price } = state.data;

  // Navbatdagi bosqichlar davomida RWcoin boshqa joyda sarflanmaganini yana bir bor tekshiramiz
  const user = await getUserByTelegramId(ctx.from.id);
  if (!user || user.rwcoin < price) {
    clearState(SCOPE, ctx.from.id);
    return replyNeedRwcoin(ctx, price);
  }

  try {
    const botDoc = await createBot({
      ownerId: ctx.from.id,
      token: state.data.token,
      botName: state.data.botName,
      description: state.data.description,
      templateType,
    });

    const spent = await spendRwcoin(ctx.from.id, price);
    if (!spent) {
      // Musobaqa holati: RWcoin boshqa joyda sarflab bo'lingan, botni ham bekor qilamiz
      await Bot.deleteOne({ _id: botDoc._id });
      clearState(SCOPE, ctx.from.id);
      return replyNeedRwcoin(ctx, price);
    }

    await startBot(botDoc);

    clearState(SCOPE, ctx.from.id);

    await ctx.reply(
      `🎉 Bot muvaffaqiyatli yaratildi va ishga tushirildi!\n\n` +
        `🤖 Nomi: ${botDoc.botName}\n` +
        `🔗 Username: @${botDoc.botUsername}\n` +
        `📦 Turi: ${templateType}\n` +
        `💰 To'lov: ${price} RWcoin\n\n` +
        `Botni "📂 Mening botlarim" bo'limidan boshqarishingiz mumkin.`,
      mainMenuInline(await isAdminUser(ctx.from.id))
    );
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Bot yaratishda xatolik');
    clearState(SCOPE, ctx.from.id);
    await ctx.reply(`❌ Bot yaratishda xatolik yuz berdi: ${err.message}`, mainMenuInline(await isAdminUser(ctx.from.id)));
    return true;
  }
}

module.exports = {
  startBotCreation,
  handleBuilderText,
  handleTemplateSelection,
};
