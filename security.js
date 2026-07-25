const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');

let redisClient = null;
if (config.redisUrl) {
  try {
    const Redis = require('ioredis');
    redisClient = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    redisClient.connect().catch((err) => {
      logger.warn({ err: err.message }, 'Redisga ulanib bo\'lmadi, xotira rejimiga o\'tildi');
      redisClient = null;
    });
  } catch (err) {
    logger.warn('ioredis topilmadi, xotira rejimida ishlaydi');
    redisClient = null;
  }
}

// ===================== TOKEN ENCRYPTION =====================

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  return crypto.createHash('sha256').update(String(config.tokenEncryptionKey)).digest();
}

function encryptToken(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: iv.toString('hex') };
}

function decryptToken(encrypted, ivHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ===================== RATE LIMIT & FLOOD (in-memory fallback) =====================

const memoryStore = new Map();

function cleanupMemoryEntry(key, windowMs) {
  setTimeout(() => memoryStore.delete(key), windowMs).unref?.();
}

async function incrCounter(key, windowMs) {
  if (redisClient && redisClient.status === 'ready') {
    const count = await redisClient.incr(key);
    if (count === 1) {
      await redisClient.pexpire(key, windowMs);
    }
    return count;
  }
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || now - entry.start > windowMs) {
    memoryStore.set(key, { count: 1, start: now });
    cleanupMemoryEntry(key, windowMs);
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

async function isRateLimited(userId) {
  const key = `ratelimit:${userId}`;
  const count = await incrCounter(key, config.rateLimitWindowMs);
  return count > config.rateLimitMax;
}

async function isFlooding(userId) {
  const key = `flood:${userId}`;
  const count = await incrCounter(key, config.floodLimitWindowMs);
  return count > config.floodLimitMax;
}

// ===================== INPUT VALIDATION =====================

function isValidBotToken(token) {
  return typeof token === 'string' && /^\d{6,12}:[A-Za-z0-9_-]{30,45}$/.test(token.trim());
}

function isValidBotName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 64;
}

function isValidDescription(desc) {
  return typeof desc === 'string' && desc.trim().length <= 512;
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
}

function isValidChannelInput(input) {
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  return /^@[\w\d_]{4,32}$/.test(trimmed) || /^-100\d{6,}$/.test(trimmed);
}

// ===================== ERROR HANDLER HELPER =====================

function safeAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'Kutilmagan xatolik');
      return null;
    }
  };
}

module.exports = {
  encryptToken,
  decryptToken,
  isRateLimited,
  isFlooding,
  isValidBotToken,
  isValidBotName,
  isValidDescription,
  sanitizeText,
  isValidChannelInput,
  safeAsync,
};
