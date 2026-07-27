const { Markup } = require('telegraf');

const mainMenu = Markup.keyboard([
  ['🤖 Bot yaratish', '📂 Mening botlarim'],
  ['👥 Referallar', '📊 Profil'],
  ['💰 RWcoin', '🏆 Auksion'],
  ['⚙️ Sozlamalar', '🆘 Yordam'],
]).resize();

const adminMenu = Markup.keyboard([
  ['👥 Foydalanuvchilar', '🤖 Botlar'],
  ['📢 Kanallar', '🔗 Referallar'],
  ['📤 Broadcast', '📊 Statistika'],
  ['🧩 Shablon yuklash', '💵 Shablon narxlari'],
  ['🏆 Auksion yaratish', '💰 RWcoin sozlamalari'],
  ['📜 Loglar', '⬅️ Asosiy menyu'],
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
function channelAuctionInline(auction, botUsername) {
  const base = auction.currentBid || 0;
  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rows = [];
  for (let i = 0; i < steps.length; i += 5) {
    rows.push(
      steps.slice(i, i + 5).map((step) =>
        Markup.button.callback(`${base + step}`, `chauc_${auction._id}_${base + step}`)
      )
    );
  }
  rows.push([Markup.button.callback('💳 Mening balansim', `chaucbal_${auction._id}`)]);
  if (botUsername) {
    rows.push([Markup.button.url('➡️ Botga qaytish', `https://t.me/${botUsername}`)]);
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
  mainMenu,
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
