const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const { Channel, Template } = require('./database');
const { checkUserSubscription } = require('./subscription');
const { subscriptionCheckInline } = require('./buttons');
const config = require('./config');
const logger = require('./logger');
const { pe } = require('./premiumEmoji');
const HTML = { parse_mode: 'HTML' };

const CUSTOM_TEMPLATES_DIR = path.join(__dirname, 'custom_templates');
if (!fs.existsSync(CUSTOM_TEMPLATES_DIR)) {
  fs.mkdirSync(CUSTOM_TEMPLATES_DIR, { recursive: true });
}

// Har bir template child botga qanday xulq-atvor ulashini belgilaydi.
// registerTemplate(bot, botDoc) chaqiriladi va bot instance ustiga handlerlar o'rnatiladi.
// Tizim kengaytiriladigan: yangi template qo'shish uchun shunchaki TEMPLATES obyektiga kalit qo'shiladi.

const TEMPLATES = {
  blank: {
    key: 'blank',
    name: 'Blank',
    description: "Bo'sh shablon, hech qanday tayyor funksiya yo'q",
    register(bot) {
      bot.start((ctx) => ctx.reply(`${pe('wave')} Salom! Bu bot hali sozlanmagan.`, HTML));
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
            `${pe('warning')} Botdan foydalanish uchun quyidagi kanallarga obuna bo'ling:`,
            { ...HTML, ...subscriptionCheckInline(notSubscribed, 'tpl_check_subscription') }
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
          await ctx.reply(`${pe('checkmark')} Obuna tasdiqlandi! Botdan foydalanishingiz mumkin.`, HTML);
        } else {
          await ctx.answerCbQuery('❌ Siz hali barcha kanallarga obuna bo\'lmadingiz.', { show_alert: true });
        }
      });

      bot.start((ctx) => ctx.reply(`${pe('wave')} Xush kelibsiz! Siz endi botdan to'liq foydalana olasiz.`, HTML));
    },
  },

  autoreply: {
    key: 'autoreply',
    name: 'Auto Reply',
    description: 'Kalit so\'zga qarab avtomatik javob beradi',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply(`${pe('wave')} Salom! Menga xabar yozing, avtomatik javob beraman.`, HTML));
      bot.on('text', async (ctx) => {
        const rules = botDoc.settings?.autoReplyRules || [];
        const text = ctx.message.text.toLowerCase();
        const rule = rules.find((r) => text.includes(String(r.keyword).toLowerCase()));
        if (rule) {
          await ctx.reply(rule.response);
        } else {
          await ctx.reply(`${pe('robot')} Sizga tez orada javob beramiz.`, HTML);
        }
      });
    },
  },

  autoforward: {
    key: 'autoforward',
    name: 'Auto Forward',
    description: 'Kelgan xabarlarni admin(lar)ga forward qiladi',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply(`${pe('wave')} Salom! Xabaringizni yuboring, u administratorga yetkaziladi.`, HTML));
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
          return ctx.reply(`${pe('wallet')} Do'kon hali bo'sh. Admin mahsulot qo'shishi kerak.`, HTML);
        }
        const buttons = products.map((p) => [Markup.button.callback(`${p.name} - ${p.price}`, `product_${p.id}`)]);
        return ctx.reply(`${pe('wallet')} Mahsulotlar ro'yxati:`, { ...HTML, ...Markup.inlineKeyboard(buttons) });
      });
      bot.action(/product_(.+)/, async (ctx) => {
        const products = botDoc.settings?.products || [];
        const product = products.find((p) => String(p.id) === ctx.match[1]);
        if (!product) return ctx.answerCbQuery('Mahsulot topilmadi');
        await ctx.answerCbQuery();
        await ctx.reply(`📦 ${product.name}\n${pe('dollar')} Narxi: ${product.price}\n📝 ${product.description || ''}`, HTML);
      });
    },
  },

  lottery: {
    key: 'lottery',
    name: 'Lottery',
    description: 'Ishtirokchilarni ro\'yxatga oluvchi oddiy lotereya boti',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply(`${pe('trophy')} Lotereyada ishtirok etish uchun /join buyrug'ini yuboring.`, HTML));
      bot.command('join', async (ctx) => {
        botDoc.settings.participants = botDoc.settings.participants || [];
        const already = botDoc.settings.participants.find((p) => p.id === ctx.from.id);
        if (already) return ctx.reply(`${pe('checkmark')} Siz allaqachon ishtirokchisiz!`, HTML);
        botDoc.settings.participants.push({ id: ctx.from.id, username: ctx.from.username || null });
        botDoc.markModified('settings');
        await botDoc.save();
        await ctx.reply(`${pe('fire')} Siz lotereyaga muvaffaqiyatli qo'shildingiz!`, HTML);
      });
    },
  },

  support: {
    key: 'support',
    name: 'Support',
    description: 'Foydalanuvchi va admin o\'rtasida murojaat boti',
    register(bot, botDoc) {
      bot.start((ctx) => ctx.reply(`${pe('bell')} Savolingizni yozing, tez orada javob beramiz.`, HTML));
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
        await ctx.reply(`${pe('checkmark')} Xabaringiz qabul qilindi, tez orada javob beramiz.`, HTML);
      });
    },
  },
};

async function getTemplateList() {
  const keys = Object.values(TEMPLATES).map((t) => t.key);
  const priceDocs = await Template.find({ key: { $in: keys } }, { key: 1, priceRwcoin: 1 }).lean();
  const priceMap = new Map(priceDocs.map((d) => [d.key, d.priceRwcoin]));
  return Object.values(TEMPLATES).map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    priceRwcoin: priceMap.has(t.key) ? priceMap.get(t.key) : config.defaultTemplatePriceRwcoin,
  }));
}

async function getTemplatePrice(key) {
  const doc = await Template.findOne({ key }, { priceRwcoin: 1 });
  return doc ? doc.priceRwcoin : config.defaultTemplatePriceRwcoin;
}

async function setTemplatePrice(key, priceRwcoin) {
  const template = getTemplate(key);
  return Template.updateOne(
    { key },
    {
      $set: { priceRwcoin: Number(priceRwcoin) },
      $setOnInsert: {
        name: template.name,
        description: template.description,
        isCustom: !!TEMPLATES[key] && key !== 'blank' && !['blank', 'subscription', 'autoreply', 'autoforward', 'shop', 'lottery', 'support'].includes(key),
      },
    },
    { upsert: true }
  );
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

function slugifyKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\.js$/i, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || `custom_${Date.now()}`;
}

/**
 * Yuklab olingan .js fayl kodini tekshiradi va shablon sifatida ro'yxatga oladi.
 * Fayl module.exports = { name, description, register(bot, botDoc) {...} } shaklida bo'lishi kerak.
 */
function validateAndLoadTemplateModule(filePath) {
  // Har safar diskdan yangilanган holatda o'qish uchun require cache tozalanadi
  delete require.cache[require.resolve(filePath)];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(filePath);

  if (!mod || typeof mod.register !== 'function') {
    const err = new Error(
      "Fayl noto'g'ri formatda. U 'module.exports = { name, description, register(bot, botDoc) {...} }' ko'rinishida bo'lishi kerak."
    );
    err.code = 'INVALID_TEMPLATE_MODULE';
    throw err;
  }
  return mod;
}

async function registerCustomTemplateFromCode({ key, name, description, code, fileName, addedBy }) {
  const safeKey = slugifyKey(key);
  const filePath = path.join(CUSTOM_TEMPLATES_DIR, `${safeKey}.js`);
  fs.writeFileSync(filePath, code, 'utf8');

  let mod;
  try {
    mod = validateAndLoadTemplateModule(filePath);
  } catch (err) {
    // Yaroqsiz faylni diskdan o'chirib tashlaymiz
    fs.unlinkSync(filePath);
    throw err;
  }

  const finalName = name || mod.name || safeKey;
  const finalDescription = description || mod.description || "Admin tomonidan yuklangan maxsus shablon";

  addCustomTemplate(safeKey, {
    name: finalName,
    description: finalDescription,
    register: mod.register,
  });

  await Template.updateOne(
    { key: safeKey },
    {
      $set: {
        name: finalName,
        description: finalDescription,
        isActive: true,
        isCustom: true,
        code,
        fileName: fileName || `${safeKey}.js`,
        addedBy: addedBy || null,
      },
      $setOnInsert: { priceRwcoin: config.defaultTemplatePriceRwcoin },
    },
    { upsert: true }
  );

  logger.info({ key: safeKey, addedBy }, "Yangi maxsus shablon botlar ro'yxatiga qo'shildi");

  return { key: safeKey, name: finalName, description: finalDescription };
}

/**
 * Server qayta ishga tushganda, oldin yuklangan barcha maxsus shablonlarni
 * bazadan o'qib, TEMPLATES ro'yxatiga qayta ro'yxatdan o'tkazadi.
 */
async function loadCustomTemplatesFromDb() {
  const docs = await Template.find({ isCustom: true, isActive: true });
  for (const doc of docs) {
    try {
      const filePath = path.join(CUSTOM_TEMPLATES_DIR, doc.fileName || `${doc.key}.js`);
      fs.writeFileSync(filePath, doc.code, 'utf8');
      const mod = validateAndLoadTemplateModule(filePath);
      addCustomTemplate(doc.key, {
        name: doc.name,
        description: doc.description,
        register: mod.register,
      });
    } catch (err) {
      logger.error({ err: err.message, key: doc.key }, "Maxsus shablonni yuklashda xatolik");
    }
  }
  if (docs.length) {
    logger.info(`${docs.length} ta maxsus shablon bazadan yuklandi`);
  }
}

module.exports = {
  TEMPLATES,
  getTemplateList,
  getTemplate,
  registerTemplate,
  addCustomTemplate,
  registerCustomTemplateFromCode,
  loadCustomTemplatesFromDb,
  getTemplatePrice,
  setTemplatePrice,
};
