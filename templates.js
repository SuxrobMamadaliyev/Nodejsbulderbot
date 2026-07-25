const { Markup } = require('telegraf');
const { Channel } = require('./database');
const { checkUserSubscription } = require('./subscription');
const { subscriptionCheckInline } = require('./buttons');
const logger = require('./logger');

// Har bir template child botga qanday xulq-atvor ulashini belgilaydi.
// registerTemplate(bot, botDoc) chaqiriladi va bot instance ustiga handlerlar o'rnatiladi.
// Tizim kengaytiriladigan: yangi template qo'shish uchun shunchaki TEMPLATES obyektiga kalit qo'shiladi.

const TEMPLATES = {
  blank: {
    key: 'blank',
    name: 'Blank',
    description: "Bo'sh shablon, hech qanday tayyor funksiya yo'q",
    register(bot) {
      bot.start((ctx) => ctx.reply('👋 Salom! Bu bot hali sozlanmagan.'));
    },
  },

  subscription: {
    key: 'subscription',
    name: 'Majburiy obuna',
    description: 'Foydalanuvchi kanal(lar)ga obuna bo\'lmasa botdan foydalana olmaydi',
    register(bot, botDoc) {
      bot.use(async (ctx, next) => {
        if (ctx.updateType !== 'message' && ctx.updateType !== 'callback_query') return next();
        const channels = await Channel.find({ scope: 'bot', botId: botDoc._id });
        if (!channels.length) return next();
        const userId = ctx.from?.id;
        if (!userId) return next();
        const { isSubscribed, notSubscribed } = await checkUserSubscription(ctx.telegram, userId, channels);
        if (!isSubscribed) {
          await ctx.reply(
            '⚠️ Botdan foydalanish uchun quyidagi kanallarga obuna bo\'ling:',
            subscriptionCheckInline(notSubscribed, 'tpl_check_subscription')
          );
          return;
        }
        return next();
      });

      bot.action('tpl_check_subscription', async (ctx) => {
        const channels = await Channel.find({ scope: 'bot', botId: botDoc._id });
        const { isSubscribed, notSubscribed } = await checkUserSubscription(ctx.telegram, ctx.from.id, channels);
        if (isSubscribed) {
          await ctx.answerCbQuery('✅ Obuna tasdiqlandi!');
          await ctx.reply('✅ Obuna tasdiqlandi! Botdan foydalanishingiz mumkin.');
        } else {
          await ctx.answerCbQuery('❌ Siz hali barcha kanallarga obuna bo\'lmadingiz.', { show_alert: true });
        }
      });

      bot.start((ctx) => ctx.reply('👋 Xush kelibsiz! Siz endi botdan to\'liq foydalana olasiz.'));
    },
  },

  autoreply: {
    key: 'autoreply',
    name: 'Auto Reply',
    description: 'Kalit so\'zga qarab avtomatik javob beradi',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply('👋 Salom! Menga xabar yozing, avtomatik javob beraman.'));
      bot.on('text', async (ctx) => {
        const rules = botDoc.settings?.autoReplyRules || [];
        const text = ctx.message.text.toLowerCase();
        const rule = rules.find((r) => text.includes(String(r.keyword).toLowerCase()));
        if (rule) {
          await ctx.reply(rule.response);
        } else {
          await ctx.reply('🤖 Sizga tez orada javob beramiz.');
        }
      });
    },
  },

  autoforward: {
    key: 'autoforward',
    name: 'Auto Forward',
    description: 'Kelgan xabarlarni admin(lar)ga forward qiladi',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply('👋 Salom! Xabaringizni yuboring, u administratorga yetkaziladi.'));
      bot.on('message', async (ctx) => {
        const targets = botDoc.settings?.forwardTargets || [botDoc.ownerId];
        for (const targetId of targets) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await ctx.forwardMessage(targetId);
          } catch (err) {
            logger.warn({ err: err.message }, 'Auto-forward xatolik');
          }
        }
      });
    },
  },

  shop: {
    key: 'shop',
    name: 'Shop',
    description: 'Oddiy katalog asosidagi do\'kon boti',
    register(bot, botDoc) {
      bot.start((ctx) => {
        const products = botDoc.settings?.products || [];
        if (!products.length) {
          return ctx.reply('🛒 Do\'kon hali bo\'sh. Admin mahsulot qo\'shishi kerak.');
        }
        const buttons = products.map((p) => [Markup.button.callback(`${p.name} - ${p.price}`, `product_${p.id}`)]);
        return ctx.reply('🛒 Mahsulotlar ro\'yxati:', Markup.inlineKeyboard(buttons));
      });
      bot.action(/product_(.+)/, async (ctx) => {
        const products = botDoc.settings?.products || [];
        const product = products.find((p) => String(p.id) === ctx.match[1]);
        if (!product) return ctx.answerCbQuery('Mahsulot topilmadi');
        await ctx.answerCbQuery();
        await ctx.reply(`📦 ${product.name}\n💰 Narxi: ${product.price}\n📝 ${product.description || ''}`);
      });
    },
  },

  lottery: {
    key: 'lottery',
    name: 'Lottery',
    description: 'Ishtirokchilarni ro\'yxatga oluvchi oddiy lotereya boti',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply('🎟 Lotereyada ishtirok etish uchun /join buyrug\'ini yuboring.'));
      bot.command('join', async (ctx) => {
        botDoc.settings.participants = botDoc.settings.participants || [];
        const already = botDoc.settings.participants.find((p) => p.id === ctx.from.id);
        if (already) return ctx.reply('✅ Siz allaqachon ishtirokchisiz!');
        botDoc.settings.participants.push({ id: ctx.from.id, username: ctx.from.username || null });
        botDoc.markModified('settings');
        await botDoc.save();
        await ctx.reply('🎉 Siz lotereyaga muvaffaqiyatli qo\'shildingiz!');
      });
    },
  },

  support: {
    key: 'support',
    name: 'Support',
    description: 'Foydalanuvchi va admin o\'rtasida murojaat boti',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply('🆘 Savolingizni yozing, tez orada javob beramiz.'));
      bot.on('message', async (ctx) => {
        if (ctx.from.id === botDoc.ownerId) {
          if (ctx.message.reply_to_message) {
            const map = botDoc.settings?.ticketMap || {};
            const targetUserId = map[ctx.message.reply_to_message.message_id];
            if (targetUserId) {
              await ctx.telegram.copyMessage(targetUserId, ctx.chat.id, ctx.message.message_id).catch(() => {});
            }
          }
          return;
        }
        const sent = await ctx.telegram.forwardMessage(botDoc.ownerId, ctx.chat.id, ctx.message.message_id);
        botDoc.settings.ticketMap = botDoc.settings.ticketMap || {};
        botDoc.settings.ticketMap[sent.message_id] = ctx.from.id;
        botDoc.markModified('settings');
        await botDoc.save();
        await ctx.reply('✅ Xabaringiz qabul qilindi, tez orada javob beramiz.');
      });
    },
  },
};

function getTemplateList() {
  return Object.values(TEMPLATES).map((t) => ({ key: t.key, name: t.name, description: t.description }));
}

function getTemplate(key) {
  return TEMPLATES[key] || TEMPLATES.blank;
}

function registerTemplate(key, botInstance, botDoc) {
  const template = getTemplate(key);
  template.register(botInstance, botDoc);
}

function addCustomTemplate(key, definition) {
  TEMPLATES[key] = { key, ...definition };
}

module.exports = {
  TEMPLATES,
  getTemplateList,
  getTemplate,
  registerTemplate,
  addCustomTemplate,
};
