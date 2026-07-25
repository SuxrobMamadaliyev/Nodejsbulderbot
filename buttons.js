const { Markup } = require('telegraf');

const mainMenu = Markup.keyboard([
  ['🤖 Bot yaratish', '📂 Mening botlarim'],
  ['👥 Referallar', '📊 Profil'],
  ['⚙️ Sozlamalar', '🆘 Yordam'],
]).resize();

const adminMenu = Markup.keyboard([
  ['👥 Foydalanuvchilar', '🤖 Botlar'],
  ['📢 Kanallar', '🔗 Referallar'],
  ['📤 Broadcast', '📊 Statistika'],
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

function templateSelectionInline() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬜ Blank', 'tpl_blank')],
    [Markup.button.callback('🔒 Majburiy obuna', 'tpl_subscription')],
    [Markup.button.callback('🤖 Auto Reply', 'tpl_autoreply')],
    [Markup.button.callback('↪️ Auto Forward', 'tpl_autoforward')],
    [Markup.button.callback('🛒 Shop', 'tpl_shop')],
    [Markup.button.callback('🎟 Lottery', 'tpl_lottery')],
    [Markup.button.callback('🆘 Support', 'tpl_support')],
  ]);
}

function subscriptionCheckInline(channels, checkCallback = 'check_subscription') {
  const rows = channels.map((ch) => [
    Markup.button.url(`📢 ${ch.title || ch.username || ch.chatId}`, ch.inviteLink || `https://t.me/${(ch.username || '').replace('@', '')}`),
  ]);
  rows.push([Markup.button.callback('✅ Obuna bo\'ldim', checkCallback)]);
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
  subscriptionCheckInline,
  botListInline,
  botManageInline,
  paginationInline,
};
