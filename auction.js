const { Auction, User } = require('./database');
const { addRwcoin, spendRwcoin } = require('./users');
const logger = require('./logger');

// ===================== AUKSION QOIDALARI (KONSTANTALAR) =====================
const MIN_USER_AUCTION_BID = 1; // auksionni 1 RWcoindan boshlash mumkin
const MAX_BID_STEP = 10; // har bir garov joriy stavkadan ko'pi bilan 10 RWcoinga oshirilishi mumkin
const BID_EXTENSION_MINUTES = 10; // har bir garovdan so'ng auksion 10 daqiqaga uzaytiriladi
const MIN_BIDS_TO_END = 10; // auksion shu qadar garovga yetsa, tugashi mumkin (informatsion)
const WINNER_PAYOUT_PERCENT = 0.9; // g'olib bankning 90%ini oladi

/**
 * KOIN AUKSIONI - QANDAY ISHLAYDI (YANGI QOIDALAR)
 * - Auksionni istalgan foydalanuvchi 1 RWcoindan boshlashi mumkin.
 * - Har qanday ishtirokchi oldingi garovni oshirishi mumkin, lekin bir vaqtning
 *   o'zida joriy stavkadan ko'pi bilan MAX_BID_STEP (10) RWcoinga ko'p qilib.
 * - Foydalanuvchi ketma-ket ikki marta stavka qo'ya olmaydi (o'zini o'zi
 *   oshira olmaydi) - shu bois "already_leading" tekshiruvi bor.
 * - Har bir muvaffaqiyatli garovdan so'ng auksion tugash vaqti hozirgi
 *   vaqtdan BID_EXTENSION_MINUTES (10) daqiqaga uzaytiriladi.
 * - MUHIM: bu yerda ESKI "qaytarib berish" mantig'i YO'Q. Har bir garov
 *   qo'yilganda RWcoin darhol foydalanuvchidan yechiladi va auksion bankiga
 *   (bank maydoni) qo'shiladi - agar boshqa birov ustidan garov qo'ysa ham,
 *   avvalgi ishtirokchining puli QAYTARILMAYDI. Auksion tugaganda faqat
 *   oxirgi (eng yuqori) garovchi g'olib hisoblanadi va bankning 90%ini oladi.
 *   Qolgan 10% xizmat haqi sifatida hech kimga qaytarilmaydi.
 */

async function createAuction({ title, description, minBid, durationMinutes, createdBy, startBid = null }) {
  const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  // Auksionni boshlovchi o'zining garovini darhol birinchi stavka sifatida
  // qo'yadi va uning RWcoini shu zahoti yechiladi (qaytarilmaydigan bankka tushadi).
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
      minBid,
      currentBid: startBid || 0,
      currentBidderId: startBid ? createdBy : null,
      bank: startBid || 0,
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
 * Stavka qo'yish. Qoidalar:
 * - joriy stavkadan kamida 1, ko'pi bilan MAX_BID_STEP (10) RWcoin ko'p bo'lishi kerak;
 * - hozirgi yetakchi ketma-ket o'zini o'zi oshira olmaydi;
 * - muvaffaqiyatli garov: RWcoin darhol yechiladi, bankka to'liq qo'shiladi
 *   (avvalgi garovchiga HECH NARSA qaytarilmaydi), auksion muddati
 *   BID_EXTENSION_MINUTES ga uzaytiriladi.
 * Musobaqa sharti optimistik yangilanish (currentBid maydoni orqali) bilan
 * tekshiriladi, shu bois parallel so'rovlarda ikki kishi bir vaqtda g'olib
 * bo'lib qolmaydi.
 */
async function placeBid(auctionId, telegramId, bidAmount) {
  const auction = await Auction.findById(auctionId);
  if (!auction) return { ok: false, reason: 'not_found' };
  if (auction.status !== 'active' || auction.endsAt <= new Date()) {
    return { ok: false, reason: 'ended' };
  }
  if (auction.currentBidderId === telegramId) {
    return { ok: false, reason: 'already_leading' };
  }

  const minRequired = Math.max(auction.minBid, auction.currentBid + 1);
  const maxAllowed = auction.currentBid + MAX_BID_STEP;
  if (bidAmount < minRequired) {
    return { ok: false, reason: 'too_low', minRequired };
  }
  if (bidAmount > maxAllowed) {
    return { ok: false, reason: 'too_high', maxAllowed };
  }

  const hasFunds = await spendRwcoin(telegramId, bidAmount);
  if (!hasFunds) {
    return { ok: false, reason: 'no_rwcoin' };
  }

  const previousBidderId = auction.currentBidderId;
  const previousBid = auction.currentBid;
  const newEndsAt = new Date(Date.now() + BID_EXTENSION_MINUTES * 60 * 1000);

  const updated = await Auction.findOneAndUpdate(
    { _id: auctionId, status: 'active', currentBid: previousBid },
    {
      $set: { currentBid: bidAmount, currentBidderId: telegramId, endsAt: newEndsAt },
      $inc: { bidsCount: 1, bank: bidAmount },
    },
    { new: true }
  );

  if (!updated) {
    // Boshqa foydalanuvchi bir vaqtda stavka qo'ygan - RWcoinni qaytarib beramiz
    // (bu holatda garov umuman qabul qilinmadi, shuning uchun qaytarish to'g'ri).
    await addRwcoin(telegramId, bidAmount);
    return { ok: false, reason: 'race_condition' };
  }

  // Eslatma: previousBidderId/previousBid faqat XABAR berish uchun qaytariladi -
  // ularning puli endi qaytarilmaydi, chunki qoidaga ko'ra bank bo'lib qoladi.
  return { ok: true, auction: updated, previousBidderId, previousBid };
}

/**
 * Muddati tugagan barcha faol auksionlarni yopadi va g'olibga
 * (oxirgi eng yuqori garovchiga) bankning 90%ini beradi. Scheduler
 * tomonidan chaqiriladi.
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
    if (auction.currentBidderId && auction.bank > 0) {
      const payout = Math.floor(auction.bank * WINNER_PAYOUT_PERCENT);
      await addRwcoin(auction.currentBidderId, payout);
      auction.winnerId = auction.currentBidderId;
      auction.payoutAmount = payout;
      auction.status = 'ended';
      await auction.save();
      logger.info(
        { auctionId: auction._id.toString(), winner: auction.winnerId, payout, bank: auction.bank },
        'Auksion yakunlandi, g\'olibga bankning 90%i berildi'
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
  if (finished) {
    const payout = auction.payoutAmount || Math.floor(auction.bank * WINNER_PAYOUT_PERCENT);
    return (
      `⭐ - Auksion tugadi\n` +
      `⭐ - G'olibning oxirgi garovi: ${auction.currentBid} RWcoin\n` +
      `⭐ - Auksion banki: ${auction.bank} RWcoin\n` +
      `⭐ - G'olib bankning 90%ini oldi: +${payout} RWcoin`
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
    `⭐ - Auksion banki: ${auction.bank} RWcoin\n` +
    `⭐ - Garovlar soni: ${auction.bidsCount}ta\n` +
    `⭐ - Joriy stavka: ${auction.currentBid} RWcoin\n` +
    `⭐ - Keyingi stavka: ${auction.currentBid + 1} dan ${auction.currentBid + MAX_BID_STEP} RWcoingacha\n` +
    `⭐ - Garovni oshirish uchun tugmalardan foydalaning`
  );
}

/**
 * Auksionni bekor qilish (faqat admin uchun). YANGI QOIDAGA KO'RA hech kimga
 * pul qaytarilmaydi - qo'yilgan barcha garovlar bankda "yo'qoladi". Shu bois
 * bu funksiyadan juda ehtiyotkorlik bilan foydalanish kerak.
 */
async function cancelAuction(auctionId) {
  const auction = await Auction.findById(auctionId);
  if (!auction) return { ok: false, reason: 'not_found' };
  auction.status = 'cancelled';
  await auction.save();
  return { ok: true };
}

module.exports = {
  MIN_USER_AUCTION_BID,
  MAX_BID_STEP,
  BID_EXTENSION_MINUTES,
  MIN_BIDS_TO_END,
  WINNER_PAYOUT_PERCENT,
  renderChannelAuctionText,
  createAuction,
  getActiveAuctions,
  getAuctionById,
  placeBid,
  closeExpiredAuctions,
  cancelAuction,
};
