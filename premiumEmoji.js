// Premium (custom) Telegram emojilar uchun helper.
//
// MUHIM CHEKLOV: Telegram Bot API custom_emoji entity'ni FAQAT oddiy xabar
// matnida (message text / caption) ko'rsatadi. Inline yoki reply
// klaviatura tugmalari matnida custom emoji ishlamaydi — Telegram buni
// umuman qo'llab-quvvatlamaydi, shuning uchun buttons.js dagi tugmalar
// oddiy unicode emojilar bilan qoladi.
//
// Custom emoji faqat parse_mode: 'HTML' bilan yuborilgan xabarlarda
// <tg-emoji emoji-id="...">fallback</tg-emoji> ko'rinishida ishlaydi.
// fallback (oddiy unicode emoji) — mijoz custom emojini ko'rsata olmasa
// (masalan eski klient) shu ko'rinadi, shuning uchun har doim original
// unicode emojiga yaqin belgi qo'yiladi.
//
// ID'lar manbasi: https://zulut30.github.io/premium-telegram-emoji/

const EMOJI = {
  wave: { id: '5870734657384877785', fallback: '👋' },
  robot: { id: '5931415565955503486', fallback: '🤖' },
  fire: { id: '5424972470023104089', fallback: '🔥' },
  star: { id: '5438496463044752972', fallback: '⭐' },
  checkmark: { id: '5206607081334906820', fallback: '✅' },
  cross: { id: '5210952531676504517', fallback: '❌' },
  warning: { id: '5447644880824181073', fallback: '⚠️' },
  bell: { id: '5458603043203327669', fallback: '🔔' },
  settings: { id: '5341715473882955310', fallback: '⚙️' },
  chart: { id: '5231200819986047254', fallback: '📊' },
  chartUp: { id: '5449683594425410231', fallback: '📈' },
  dollar: { id: '5409048419211682843', fallback: '💵' },
  link: { id: '5271604874419647061', fallback: '🔗' },
  lock: { id: '5296369303661067030', fallback: '🔒' },
  calendar: { id: '5413879192267805083', fallback: '📅' },
  idea: { id: '5422439311196834318', fallback: '💡' },
  free: { id: '5406756500108501710', fallback: '🆓' },
  gift: { id: '5397916757333654639', fallback: '➕' },
  people: { id: '5942877472163892475', fallback: '👥' },
  profile: { id: '5879770735999717115', fallback: '👤' },
  envelope: { id: '5967280668885913944', fallback: '✉️' },
  wallet: { id: '5769403330761593044', fallback: '👛' },
  trophy: { id: '5935847413859225147', fallback: '🏆' },
  announcement: { id: '5424818078833715060', fallback: '📢' },
  info: { id: '5323442290708985472', fallback: 'ℹ️' },
  top: { id: '5415655814079723871', fallback: '🔝' },
  soon: { id: '5440621591387980068', fallback: '⏳' },
  pin: { id: '5397782960512444700', fallback: '📌' },
  trash: { id: '5879896690210639947', fallback: '🗑' },
  refresh: { id: '5375338737028841420', fallback: '🔄' },
  eye: { id: '5960714428394507968', fallback: '👁' },
  verified: { id: '5805532930662996322', fallback: '✅' },
};

/**
 * Berilgan kalit uchun premium emoji HTML tegini qaytaradi.
 * parse_mode: 'HTML' bilan birga ishlatilishi shart.
 * Kalit topilmasa, xatolik bermay oddiy bo'sh satr qaytaradi.
 */
function pe(key) {
  const e = EMOJI[key];
  if (!e) return '';
  return `<tg-emoji emoji-id="${e.id}">${e.fallback}</tg-emoji>`;
}

module.exports = { EMOJI, pe };
