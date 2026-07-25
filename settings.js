const { Settings } = require('./database');
const config = require('./config');

const CACHE = new Map();
const CACHE_TTL = 60 * 1000;

async function getSetting(key, defaultValue = null) {
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.value;
  }
  const doc = await Settings.findOne({ key });
  const value = doc ? doc.value : defaultValue;
  CACHE.set(key, { value, time: Date.now() });
  return value;
}

async function setSetting(key, value) {
  await Settings.updateOne({ key }, { $set: { value } }, { upsert: true });
  CACHE.set(key, { value, time: Date.now() });
  return value;
}

async function getReferralRequired() {
  const value = await getSetting('referral_required', config.defaultReferralRequired);
  return Number(value) || config.defaultReferralRequired;
}

async function setReferralRequired(count) {
  return setSetting('referral_required', Number(count));
}

async function getBotsPerReferralBatch() {
  const value = await getSetting('bots_per_batch', 1);
  return Number(value) || 1;
}

module.exports = {
  getSetting,
  setSetting,
  getReferralRequired,
  setReferralRequired,
  getBotsPerReferralBatch,
};
