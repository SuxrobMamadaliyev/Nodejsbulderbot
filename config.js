require('dotenv').config();

function parseIds(str) {
  if (!str) return [];
  return str.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
}

const config = {
  botToken: process.env.BOT_TOKEN || '',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
  useWebhook: (process.env.USE_WEBHOOK || 'false').toLowerCase() === 'true',
  webhookSecret: process.env.WEBHOOK_SECRET || 'secret',

  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/botbuilder',

  redisUrl: process.env.REDIS_URL || '',
  upstashRestUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  upstashRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',

  superAdminIds: parseIds(process.env.SUPER_ADMIN_IDS),

  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || 'default_dev_key_change_me_32chars',

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '10000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '15', 10),
  floodLimitMax: parseInt(process.env.FLOOD_LIMIT_MAX || '5', 10),
  floodLimitWindowMs: parseInt(process.env.FLOOD_LIMIT_WINDOW_MS || '3000', 10),

  defaultRwcoinPerReferral: parseInt(process.env.DEFAULT_RWCOIN_PER_REFERRAL || '10', 10),
  defaultTemplatePriceRwcoin: parseInt(process.env.DEFAULT_TEMPLATE_PRICE_RWCOIN || '100', 10),

  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
