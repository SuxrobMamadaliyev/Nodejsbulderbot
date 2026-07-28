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

async function getMainMenuImage() {
  return getSetting('main_menu_image', null);
}

async function setMainMenuImage(fileId) {
  return setSetting('main_menu_image', fileId);
}

async function clearMainMenuImage() {
  return setSetting('main_menu_image', null);
}

async function getRwcoinPerReferral() {
  const value = await getSetting('rwcoin_per_referral', config.defaultRwcoinPerReferral);
  return Number(value) || config.defaultRwcoinPerReferral;
}

async function setRwcoinPerReferral(amount) {
  return setSetting('rwcoin_per_referral', Number(amount));
}

module.exports = {
  getSetting,
  setSetting,
  getRwcoinPerReferral,
  setRwcoinPerReferral,
  getMainMenuImage,
  setMainMenuImage,
  clearMainMenuImage,
};
