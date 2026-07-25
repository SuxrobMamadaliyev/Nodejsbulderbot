const crypto = require('crypto');

function generateReferralCode(telegramId) {
  const hash = crypto.createHash('md5').update(String(telegramId) + Date.now()).digest('hex');
  return hash.substring(0, 10);
}

function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function buildReferralLink(botUsername, referralCode) {
  return `https://t.me/${botUsername}?start=ref_${referralCode}`;
}

function extractReferralCode(startPayload) {
  if (!startPayload) return null;
  const match = /^ref_(.+)$/.exec(startPayload.trim());
  return match ? match[1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFullName(from) {
  if (!from) return 'Foydalanuvchi';
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Foydalanuvchi';
}

module.exports = {
  generateReferralCode,
  formatDate,
  todayKey,
  escapeHtml,
  chunkArray,
  buildReferralLink,
  extractReferralCode,
  sleep,
  getFullName,
};
