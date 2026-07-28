const { mainMenuInline } = require('./buttons');
const { isAdminUser } = require('./middlewares');
const { getMainMenuImage } = require('./settings');

/**
 * Asosiy menyuni yuboradi - agar admin rasm o'rnatgan bo'lsa, rasm bilan
 * (caption sifatida), aks holda oddiy matn ko'rinishida.
 */
async function sendMainMenu(ctx, text) {
  const isAdmin = await isAdminUser(ctx.from.id);
  const keyboard = mainMenuInline(isAdmin);
  const imageId = await getMainMenuImage();
  // parse_mode: 'HTML' - text ichida <tg-emoji> premium emoji teglari
  // bo'lishi mumkin (qarang: premiumEmoji.js). Oddiy matnlarga ta'sir qilmaydi.
  const extra = { parse_mode: 'HTML', ...keyboard };
  if (imageId) {
    try {
      return await ctx.replyWithPhoto(imageId, { caption: text, ...extra });
    } catch (err) {
      // rasm ID eskirgan yoki noto'g'ri bo'lsa, matn bilan yuboramiz
    }
  }
  return ctx.reply(text, extra);
}

module.exports = { sendMainMenu };
