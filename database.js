const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

// ===================== SCHEMAS =====================

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: null },
    firstName: { type: String, default: null },
    lastName: { type: String, default: null },
    referredBy: { type: Number, default: null },
    pendingReferralCode: { type: String, default: null },
    referralCode: { type: String, unique: true, index: true },
    referralsCount: { type: Number, default: 0 },
    rwcoin: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const botSchema = new mongoose.Schema(
  {
    ownerId: { type: Number, required: true, index: true },
    botToken: { type: String, required: true },
    botTokenIv: { type: String, required: true },
    botUsername: { type: String, required: true },
    botName: { type: String, required: true },
    description: { type: String, default: '' },
    templateType: { type: String, default: 'blank' },
    status: { type: String, enum: ['active', 'stopped', 'error'], default: 'stopped' },
    webhookSet: { type: Boolean, default: false },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    stats: {
      totalUsers: { type: Number, default: 0 },
      totalMessages: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

const channelSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ['master', 'bot'], default: 'master', index: true },
    botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', default: null },
    chatId: { type: String, required: true },
    title: { type: String, default: '' },
    username: { type: String, default: null },
    inviteLink: { type: String, default: null },
    addedBy: { type: Number, required: true },
  },
  { timestamps: true }
);

const referralSchema = new mongoose.Schema(
  {
    referrerId: { type: Number, required: true, index: true },
    referredId: { type: Number, required: true, unique: true },
    counted: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const templateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    isActive: { type: Boolean, default: true },
    isCustom: { type: Boolean, default: false },
    code: { type: String, default: null },
    fileName: { type: String, default: null },
    addedBy: { type: Number, default: null },
    priceRwcoin: { type: Number, default: 100 },
  },
  { timestamps: true }
);

const adminSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true },
    addedBy: { type: Number, default: null },
    role: { type: String, enum: ['super', 'admin'], default: 'admin' },
  },
  { timestamps: true }
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

const logSchema = new mongoose.Schema(
  {
    level: { type: String, default: 'info' },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const auctionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    potRwcoin: { type: Number, default: 0 }, // ESKI MODEL QOLDIG'I - endi ishlatilmaydi (bank/90% modeli)
    minBid: { type: Number, required: true, default: 10 },
    currentBid: { type: Number, default: 0 },
    currentBidderId: { type: Number, default: null },
    bank: { type: Number, default: 0 }, // barcha garovlar yig'indisi - g'olib bo'lmasa qaytarilmaydi
    bidsCount: { type: Number, default: 0 }, // jami qo'yilgan garovlar soni
    channelMessageId: { type: Number, default: null }, // kanaldagi jonli e'lon xabari ID
    status: { type: String, enum: ['active', 'ended', 'cancelled'], default: 'active' },
    endsAt: { type: Date, required: true },
    createdBy: { type: Number, required: true },
    winnerId: { type: Number, default: null },
    payoutAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const statisticsSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    newUsers: { type: Number, default: 0 },
    newBots: { type: Number, default: 0 },
    newReferrals: { type: Number, default: 0 },
    broadcastsSent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ===================== MODELS =====================

const User = mongoose.model('User', userSchema);
const Bot = mongoose.model('Bot', botSchema);
const Channel = mongoose.model('Channel', channelSchema);
const Referral = mongoose.model('Referral', referralSchema);
const Template = mongoose.model('Template', templateSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Log = mongoose.model('Log', logSchema);
const Statistics = mongoose.model('Statistics', statisticsSchema);
const Auction = mongoose.model('Auction', auctionSchema);

async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri);
  logger.info('MongoDB ulanish muvaffaqiyatli o\'rnatildi');

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB ulanish uzildi, qayta ulanishga harakat qilinmoqda...');
  });
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB xatolik');
  });

  return mongoose.connection;
}

module.exports = {
  connectDatabase,
  User,
  Bot,
  Channel,
  Referral,
  Template,
  Admin,
  Settings,
  Log,
  Statistics,
  Auction,
};
