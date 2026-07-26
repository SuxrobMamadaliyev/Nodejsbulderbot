const { Auction, User } = require('./database');
const { addRwcoin, spendRwcoin } = require('./users');
const logger = require('./logger');

// Foydalanuvchilar o'zi auksion boshlaganda talab qilinadigan eng kam garov.
const MIN_USER_AUCTION_BID = 10;

/**
 * KOIN AUKSIONI - QANDAY ISHLAYDI
 * - Admin yoki oddiy foydalanuvchi auksion ochadi: sarlavha, minimal stavka (minBid),
 *   soniyalarda muddat va g'olibga beriladigan bonus RWcoin miqdori (potRwcoin).
 * - Foydalanuvchilar o'z RWcoinlaridan stavka qo'yadi. Har bir yangi stavka
 *   avvalgi eng yuqori stavkachining RWcoinini to'liq qaytaradi va yangi
 *   stavkachining RWcoinini hisobidan yechib, auksionga "band" qiladi.
 * - Auksion muddati tugaganda: g'olib (oxirgi eng yuqori stavkachi) hisobiga
 *   o'z stavkasi + potRwcoin (bonus) qaytariladi - ya'ni u RWcoinini ko'paytiradi.
 *   Boshqa barcha ishtirokchilarning RWcoinlari darhol qaytarilgani uchun
 *   ular hech narsa yo'qotmaydi, faqat g'olib bo'lmasa bonusni yo'qotadi.
 */

async function createAuction({ title, description, potRwcoin, minBid, durationMinutes, createdBy, startBid = null }) {
  const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  // Foydalanuvchi o'zi auksion boshlasa, kiritgan garovi darhol birinchi
  // stavka sifatida qabul qilinadi va uning RWcoinidan yechiladi.
  if (startBid) {
    const hasFunds = await spendRwcoin(createdBy, startBid);
    if (!hasFunds) {
      throw new Error('RWcoin yetarli emas');
    }
  }

  try {
    return await Auction.create({
      title,
      description: description || '',
      potRwcoin,
      minBid,
      currentBid: startBid || 0,
      currentBidderId: startBid ? createdBy : null,
      bidsCount: startBid ? 1 : 0,
      status: 'active',
      endsAt,
      createdBy,
    });
  } catch (err) {
    // Auksion yozuvini yaratib bo'lmadi - yechilgan RWcoinni qaytaramiz
    if (startBid) {
      await addRwcoin(createdBy, startBid);
    }
    throw err;
  }
}

async function getActiveAuctions() {
  return Auction.find({ status: 'active', endsAt: { $gt: new Date() } }).sort({ endsAt: 1 });
}

async function getAuctionById(auctionId) {
  return Auction.findById(auctionId);
}

/**
 * Stavka qo'yish. Atomik ravishda: avvalgi stavkachiga RWcoin qaytariladi,
 * yangi stavkachidan RWcoin yechiladi. Musobaqa sharti optimistik yangilanish
 * (currentBid maydoni orqali) bilan tekshiriladi, shu bois parallel
 * so'rovlarda ikki kishi bir vaqtda g'olib bo'lib qolmaydi.
 */
async function placeBid(auctionId, telegramId, bidAmount) {
  const auction = await Auction.findById(auctionId);
  if (!auction) return { ok: false, reason: 'not_found' };
  if (auction.status !== 'active' || auction.endsAt <= new Date()) {
    return { ok: false, reason: 'ended' };
  }
  const minRequired = Math.max(auction.minBid, auction.currentBid + 1);
  if (bidAmount < minRequired) {
    return { ok: false, reason: 'too_low', minRequired };
  }
  if (auction.currentBidderId === telegramId) {
    return { ok: false, reason: 'already_leading' };
  }

  const hasFunds = await spendRwcoin(telegramId, bidAmount);
  if (!hasFunds) {
    return { ok: false, reason: 'no_rwcoin' };
  }

  // Avvalgi stavkachiga RWcoinini qaytaramiz
  const previousBidderId = auction.currentBidderId;
  const previousBid = auction.currentBid;

  const updated = await Auction.findOneAndUpdate(
    { _id: auctionId, status: 'active', currentBid: previousBid },
    { $set: { currentBid: bidAmount, currentBidderId: telegramId }, $inc: { bidsCount: 1 } },
    { new: true }
  );

  if (!updated) {
    // Boshqa foydalanuvchi bir vaqtda stavka qo'ygan - RWcoinni qaytarib beramiz
    await addRwcoin(telegramId, bidAmount);
    return { ok: false, reason: 'race_condition' };
  }

  if (previousBidderId) {
    await addRwcoin(previousBidderId, previousBid);
  }

  return { ok: true, auction: updated, previousBidderId, previousBid };
}

/**
 * Muddati tugagan barcha faol auksionlarni yopadi va g'olibga
 * stavka + bonus RWcoinlarni beradi. Scheduler tomonidan chaqiriladi.
 */
async function closeExpiredAuctions(notifyFn) {
  const expired = await Auction.find({ status: 'active', endsAt: { $lte: new Date() } });
  for (const auction of expired) {
    // eslint-disable-next-line no-await-in-loop
    await closeAuction(auction, notifyFn);
  }
  return expired.length;
}

async function closeAuction(auction, notifyFn) {
  try {
    if (auction.currentBidderId) {
      const payout = auction.currentBid + auction.potRwcoin;
      await addRwcoin(auction.currentBidderId, payout);
      auction.winnerId = auction.currentBidderId;
      auction.payoutAmount = payout;
      auction.status = 'ended';
      await auction.save();
      logger.info(
        { auctionId: auction._id.toString(), winner: auction.winnerId, payout },
        'Auksion yakunlandi, g\'olibga RWcoin berildi'
      );
      if (notifyFn) {
        await notifyFn(auction.winnerId, auction, payout).catch(() => {});
      }
    } else {
      auction.status = 'ended';
      await auction.save();
    }
  } catch (err) {
    logger.error({ err: err.message, auctionId: auction._id.toString() }, 'Auksionni yopishda xatolik');
  }
}

/**
 * Kanaldagi jonli auksion posti uchun matnni tayyorlaydi (rasmdagi
 * AuksionRasmiy namunasiga o'xshab, faqat RWcoinda). Bu funksiya sof (pure)
 * bo'lib, faqat auction hujjatiga qarab matn qaytaradi - Telegram bilan
 * bog'liq hech narsa qilmaydi, shuning uchun uni bot.js ham, scheduler.js
 * ham xavfsiz ishlata oladi.
 */
function renderChannelAuctionText(auction, { finished = false } = {}) {
  const bank = auction.currentBid + auction.potRwcoin;
  if (finished) {
    return (
      `⭐ - Auksion tugadi\n` +
      `⭐ - Lider: Foydalanuvchi tikdi: ${auction.currentBid} RWcoin\n` +
      `⭐ - Auksion banki: ${bank} RWcoin\n` +
      `⭐ - G'olib auksion bankining hammasini oldi: +${bank} RWcoin`
    );
  }
  const msLeft = Math.max(0, auction.endsAt.getTime() - Date.now());
  const totalSec = Math.floor(msLeft / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return (
    `⭐ - Auksion aktivlashdi\n` +
    `⭐ - Holati: Boshlangan\n` +
    `⭐ - Qolgan vaqt: ${hh}:${mm}:${ss}\n` +
    `⭐ - Auksion banki: ${bank} RWcoin\n` +
    `⭐ - Garovlar soni: ${auction.bidsCount}ta\n` +
    `⭐ - Lider: Foydalanuvchi tikdi: ${auction.currentBid} RWcoin\n` +
    `⭐ - Garovni oshirish uchun tugmalardan foydalaning`
  );
}

async function cancelAuction(auctionId) {
  const auction = await Auction.findById(auctionId);
  if (!auction) return { ok: false, reason: 'not_found' };
  if (auction.currentBidderId) {
    await addRwcoin(auction.currentBidderId, auction.currentBid);
  }
  auction.status = 'cancelled';
  await auction.save();
  return { ok: true };
}

module.exports = {
  MIN_USER_AUCTION_BID,
  renderChannelAuctionText,
  createAuction,
  getActiveAuctions,
  getAuctionById,
  placeBid,
  closeExpiredAuctions,
  cancelAuction,
};
