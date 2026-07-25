const { Auction, User } = require('./database');
const { addCoins, spendCoins } = require('./users');
const logger = require('./logger');

/**
 * KOIN AUKSIONI - QANDAY ISHLAYDI
 * - Admin auksion ochadi: sarlavha, minimal stavka (minBid), soniyalarda muddat
 *   va g'olibga beriladigan bonus koin miqdori (potCoins).
 * - Foydalanuvchilar o'z koinlaridan stavka qo'yadi. Har bir yangi stavka
 *   avvalgi eng yuqori stavkachining koinini to'liq qaytaradi va yangi
 *   stavkachining koinini hisobidan yechib, auksionga "band" qiladi.
 * - Auksion muddati tugaganda: g'olib (oxirgi eng yuqori stavkachi) hisobiga
 *   o'z stavkasi + potCoins (bonus) qaytariladi - ya'ni u koinini ko'paytiradi.
 *   Boshqa barcha ishtirokchilarning koinlari darhol qaytarilgani uchun
 *   ular hech narsa yo'qotmaydi, faqat g'olib bo'lmasa bonusni yo'qotadi.
 */

async function createAuction({ title, description, potCoins, minBid, durationMinutes, createdBy }) {
  const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);
  return Auction.create({
    title,
    description: description || '',
    potCoins,
    minBid,
    currentBid: 0,
    currentBidderId: null,
    status: 'active',
    endsAt,
    createdBy,
  });
}

async function getActiveAuctions() {
  return Auction.find({ status: 'active', endsAt: { $gt: new Date() } }).sort({ endsAt: 1 });
}

async function getAuctionById(auctionId) {
  return Auction.findById(auctionId);
}

/**
 * Stavka qo'yish. Atomik ravishda: avvalgi stavkachiga koin qaytariladi,
 * yangi stavkachidan koin yechiladi. Musobaqa sharti optimistik yangilanish
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

  const hasFunds = await spendCoins(telegramId, bidAmount);
  if (!hasFunds) {
    return { ok: false, reason: 'no_coins' };
  }

  // Avvalgi stavkachiga koinini qaytaramiz
  const previousBidderId = auction.currentBidderId;
  const previousBid = auction.currentBid;

  const updated = await Auction.findOneAndUpdate(
    { _id: auctionId, status: 'active', currentBid: previousBid },
    { $set: { currentBid: bidAmount, currentBidderId: telegramId } },
    { new: true }
  );

  if (!updated) {
    // Boshqa foydalanuvchi bir vaqtda stavka qo'ygan - koinni qaytarib beramiz
    await addCoins(telegramId, bidAmount);
    return { ok: false, reason: 'race_condition' };
  }

  if (previousBidderId) {
    await addCoins(previousBidderId, previousBid);
  }

  return { ok: true, auction: updated, previousBidderId, previousBid };
}

/**
 * Muddati tugagan barcha faol auksionlarni yopadi va g'olibga
 * stavka + bonus koinlarni beradi. Scheduler tomonidan chaqiriladi.
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
      const payout = auction.currentBid + auction.potCoins;
      await addCoins(auction.currentBidderId, payout);
      auction.winnerId = auction.currentBidderId;
      auction.payoutAmount = payout;
      auction.status = 'ended';
      await auction.save();
      logger.info(
        { auctionId: auction._id.toString(), winner: auction.winnerId, payout },
        'Auksion yakunlandi, g\'olibga koin berildi'
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

async function cancelAuction(auctionId) {
  const auction = await Auction.findById(auctionId);
  if (!auction) return { ok: false, reason: 'not_found' };
  if (auction.currentBidderId) {
    await addCoins(auction.currentBidderId, auction.currentBid);
  }
  auction.status = 'cancelled';
  await auction.save();
  return { ok: true };
}

module.exports = {
  createAuction,
  getActiveAuctions,
  getAuctionById,
  placeBid,
  closeExpiredAuctions,
  cancelAuction,
};
