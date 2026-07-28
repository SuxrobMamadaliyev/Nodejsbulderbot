const { Markup } = require('telegraf');

// Asosiy menyu - inline tugmalar ko'rinishida.
// isAdmin=true bo'lsa, pastiga "👨‍💻 Admin panel" tugmasi ham qo'shiladi.
// Bot API 9.4 (2026-02-09) "style" maydonini qo'llab-quvvatlaydi:
// "success" (yashil), "primary" (ko'k), "danger" (qizil).
function styledCb(text, data, style) {
  return { ...Markup.button.callback(text, data), style };
}

function mainMenuInline(isAdmin = false) {
  const rows = [
    [styledCb('🏆 Auksion', 'menu_auction', 'success')],
    [
      styledCb('🤖 Bot yaratish', 'menu_create_bot', 'primary'),
      styledCb('📂 Mening botlarim', 'menu_my_bots', 'primary'),
    ],
    [
      styledCb('👥 Referallar', 'menu_referrals', 'success'),
      styledCb('📊 Profil', 'menu_profile', 'primary'),
    ],
    [
      styledCb('⚙️ Sozlamalar', 'menu_settings', 'primary'),
      styledCb('🆘 Yordam', 'menu_help', 'primary'),
    ],
  ];
  if (isAdmin) {
    rows.push([styledCb('👨‍💻 Admin panel', 'menu_admin', 'danger')]);
  }
  return Markup.inlineKeyboard(rows);
}

// Har qanday ekrandan asosiy menyuga qaytish uchun kichik inline tugma.
function backToMainMenuInline() {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Asosiy menyu', 'menu_back')]]);
}

function mainMenuImageAdminInline(hasImage) {
  const rows = [[{ ...Markup.button.callback('🖼 Rasm qo\'yish / almashtirish', 'mmimg_set'), style: 'primary' }]];
  if (hasImage) {
    rows.push([{ ...Markup.button.callback('🗑 Rasmni o\'chirish', 'mmimg_clear'), style: 'danger' }]);
  }
  return Markup.inlineKeyboard(rows);
}

const adminMenu = Markup.keyboard([
  ['👥 Foydalanuvchilar', '🤖 Botlar'],
  ['📢 Kanallar', '🔗 Referallar'],
  ['📤 Broadcast', '📊 Statistika'],
  ['🧩 Shablon yuklash', '💵 Shablon narxlari'],
  ['🏆 Auksion yaratish', '💰 RWcoin sozlamalari'],
  ['🖼 Asosiy menyu rasmi', '📜 Loglar'],
  ['⬅️ Asosiy menyu'],
]).resize();

const cancelKeyboard = Markup.keyboard([['❌ Bekor qilish']]).resize();

function backKeyboard(label = '⬅️ Orqaga') {
  return Markup.keyboard([[label]]).resize();
}

function confirmInline(yesData, noData) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Tasdiqlash', yesData), Markup.button.callback('❌ Bekor qilish', noData)],
  ]);
}

// templates - {key, name, description}[] massivi, templates.js dagi getTemplateList() natijasi.
// Har doim shu ro'yxatdan tugmalar quriladi, shuning uchun admin yuklagan yangi
// (custom) shablonlar ham avtomatik ravishda bot yaratish menyusiga qo'shiladi.
function templateSelectionInline(templates = []) {
  const rows = templates.map((t) => [
    Markup.button.callback(`📦 ${t.name} — 💰${t.priceRwcoin} RWcoin`, `tpl_${t.key}`),
  ]);
  return Markup.inlineKeyboard(
    rows.length ? rows : [[Markup.button.callback('⬜ Blank', 'tpl_blank')]]
  );
}

function templatePriceListInline(templates) {
  const rows = templates.map((t) => [
    Markup.button.callback(`📦 ${t.name} — 💰${t.priceRwcoin}`, `setprice_${t.key}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function referralShareInline(link, shareText) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText || '')}`;
  return Markup.inlineKeyboard([[Markup.button.url('📤 Ulashish', shareUrl)]]);
}

function auctionListInline(auctions) {
  const rows = auctions.map((a) => [
    Markup.button.callback(`🏆 ${a.title} (band: ${a.currentBid})`, `auction_view_${a._id}`),
  ]);
  return Markup.inlineKeyboard(rows.length ? rows : [[Markup.button.callback('Auksion yo\'q', 'noop')]]);
}

function auctionDetailInline(auctionId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 Stavka qo\'yish', `auction_bid_${auctionId}`)],
    [Markup.button.callback('⬅️ Ro\'yxatga qaytish', 'auction_back')],
  ]);
}

function subscriptionCheckInline(channels, checkCallback = 'check_subscription') {
  const rows = channels.map((ch) => [
    Markup.button.url(`📢 ${ch.title || ch.username || ch.chatId}`, ch.inviteLink || `https://t.me/${(ch.username || '').replace('@', '')}`),
  ]);
  rows.push([Markup.button.callback('✅ Obuna bo\'ldim', checkCallback)]);
  return Markup.inlineKeyboard(rows);
}

function channelListInline(channels) {
  const rows = channels.map((c) => [
    Markup.button.callback(`🗑 ${c.title || c.username || c.chatId}`, `delchannel_${c._id}`),
  ]);
  return Markup.inlineKeyboard(
    rows.length ? rows : [[Markup.button.callback('Kanal yo\'q', 'noop')]]
  );
}

// Kanaldagi jonli auksion posti uchun tugmalar: tezkor stavka qiymatlari,
// balansni ko'rish va botga qaytish. Qoidaga ko'ra bir garov joriy
// stavkadan ko'pi bilan 10 RWcoinga oshirilishi mumkin, shuning uchun
// tugmalar +1 dan +10 gacha bo'lgan qiymatlarni taklif qiladi.
// `auction._id` MongoDB ID, callback_data 64 baytdan oshmasligi kerak,
// shuning uchun qisqa prefiks ishlatiladi.
// Bot API 9.4 (2026-02-09) dan boshlab InlineKeyboardButton "style" maydonini
// qo'llab-quvvatlaydi: "danger" (qizil), "primary" (ko'k), "success" (yashil).
// Telegraf 4.16.3 hali buni maxsus parametr sifatida bilmaydi, lekin
// Markup.button.callback oddiy {text, callback_data} obyekt qaytaradi va biz
// unga qo'lda "style" maydonini qo'shsak, Telegram API ga to'g'ridan-to'g'ri
// yuboriladi (telegraf noma'lum maydonlarni olib tashlamaydi).
function styledButton(text, callbackData, style) {
  return { ...Markup.button.callback(text, callbackData), style };
}

function channelAuctionInline(auction, botUsername) {
  const base = auction.currentBid || 0;
  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rows = [];

  if (botUsername) {
    rows.push([{ ...Markup.button.url('➡️ Botga qaytish', `https://t.me/${botUsername}`), style: 'primary' }]);
  }
  rows.push([styledButton('💳 Mening balansim', `chaucbal_${auction._id}`, 'primary')]);

  for (let i = 0; i < steps.length; i += 5) {
    rows.push(
      steps.slice(i, i + 5).map((step) =>
        styledButton(`${base + step}`, `chauc_${auction._id}_${base + step}`, 'success')
      )
    );
  }
  return Markup.inlineKeyboard(rows);
}

// Auksion faol bo'lmaganda "🏆 Auksion" bo'limida ko'rsatiladigan tugmalar:
// yangi auksion boshlash va auksion kanaliga o'tish.
function auctionInactiveInline(channelUrl) {
  const rows = [[Markup.button.callback('🏆 Auksion boshlash', 'start_own_auction')]];
  if (channelUrl) {
    rows.push([Markup.button.url('📢 Auksion kanalimiz', channelUrl)]);
  }
  return Markup.inlineKeyboard(rows);
}

function botListInline(bots) {
  const rows = bots.map((b) => [
    Markup.button.callback(`${b.status === 'active' ? '🟢' : '🔴'} @${b.botUsername}`, `botinfo_${b._id}`),
  ]);
  return Markup.inlineKeyboard(rows.length ? rows : [[Markup.button.callback('Bot topilmadi', 'noop')]]);
}

function botManageInline(botId, status) {
  const toggle =
    status === 'active'
      ? Markup.button.callback('⏹ To\'xtatish', `botstop_${botId}`)
      : Markup.button.callback('▶️ Ishga tushirish', `botstart_${botId}`);
  return Markup.inlineKeyboard([
    [toggle, Markup.button.callback('🔄 Qayta ishga tushirish', `botrestart_${botId}`)],
    [Markup.button.callback('🗑 O\'chirish', `botdelete_${botId}`)],
    [Markup.button.callback('⬅️ Ro\'yxatga qaytish', 'mybots_back')],
  ]);
}

function paginationInline(prefix, page, totalPages) {
  const row = [];
  if (page > 1) row.push(Markup.button.callback('⬅️', `${prefix}_${page - 1}`));
  row.push(Markup.button.callback(`${page}/${totalPages}`, 'noop'));
  if (page < totalPages) row.push(Markup.button.callback('➡️', `${prefix}_${page + 1}`));
  return Markup.inlineKeyboard([row]);
}

module.exports = {
  mainMenuInline,
  backToMainMenuInline,
  mainMenuImageAdminInline,
  adminMenu,
  cancelKeyboard,
  backKeyboard,
  confirmInline,
  templateSelectionInline,
  templatePriceListInline,
  referralShareInline,
  auctionListInline,
  auctionDetailInline,
  subscriptionCheckInline,
  channelListInline,
  channelAuctionInline,
  auctionInactiveInline,
  botListInline,
  botManageInline,
  paginationInline,
};
