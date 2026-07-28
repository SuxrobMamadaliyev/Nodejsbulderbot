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
  if (imageId) {
    try {
      return await ctx.replyWithPhoto(imageId, { caption: text, ...keyboard });
    } catch (err) {
      // rasm ID eskirgan yoki noto'g'ri bo'lsa, matn bilan yuboramiz
    }
  }
  return ctx.reply(text, keyboard);
}

module.exports = { sendMainMenu };
