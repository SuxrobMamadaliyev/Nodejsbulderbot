# Nodejsbulderbot
# 🤖 Telegram Bot Builder Platform

100% bepul, kod yozmasdan Telegram bot yaratish imkonini beruvchi platforma. Node.js, Telegraf, Express va MongoDB asosida qurilgan.

## ✨ Imkoniyatlar

- 🤖 BotFather tokeni orqali cheksiz bot yaratish (faqat referal talab qilinadi)
- 📦 Kengaytiriladigan shablon tizimi: Blank, Majburiy obuna, Auto Reply, Auto Forward, Shop, Lottery, Support
- 🔒 Majburiy obuna tizimi (`getChatMember` orqali tekshiriladi)
- 👥 Referal tizimi (admin talab qilinadigan referal sonini o'zgartira oladi)
- ⚙️ To'liq admin panel: foydalanuvchilar, botlar, kanallar, referallar, broadcast, statistika, loglar
- 📤 Broadcast: matn, rasm, video, audio, voice, gif, sticker, fayl + inline tugmalar
- 🔁 Server qayta ishga tushganda barcha faol botlar avtomatik tiklanadi
- 🛡 Rate limit, flood protection, token shifrlash, input validatsiya

## 📁 Loyiha tuzilishi

Barcha fayllar **bitta papkada** joylashgan, ichki papkalar yo'q:

```
index.js            — kirish nuqtasi
bot.js               — asosiy (master) bot
builder.js            — bot yaratish oqimi
admin.js              — admin panel
database.js           — MongoDB modellari
config.js             — konfiguratsiya
functions.js          — yordamchi funksiyalar
buttons.js             — klaviaturalar
states.js              — session/state manager
middlewares.js         — middleware'lar
botmanager.js           — child botlarni boshqarish
templates.js            — bot shablonlari
webhook.js               — webhook routerlari
deploy.js                — deploy/webhook sozlash
referral.js               — referal tizimi
subscription.js           — majburiy obuna
profile.js                — profil
statistics.js              — statistika
broadcast.js                — broadcast tizimi
users.js                    — foydalanuvchi CRUD
settings.js                  — sozlamalar (referal soni va h.k.)
security.js                   — xavfsizlik (shifrlash, limit, validatsiya)
scheduler.js                  — cron vazifalar
logger.js                     — pino logger
api.js                         — REST API
server.js                      — Express server
package.json
.env.example
```

## 🚀 O'rnatish

### 1. Talablar

- Node.js 22+
- MongoDB (lokal yoki MongoDB Atlas)
- (Ixtiyoriy) Redis — bo'lmasa tizim avtomatik xotira rejimida ishlaydi
- Telegram bot tokeni ([@BotFather](https://t.me/BotFather) orqali)

### 2. Loyihani yuklab olish va sozlash

```bash
# Fayllarni papkaga joylashtiring, so'ng:
cd telegram-bot-builder-platform
npm install
cp .env.example .env
```

`.env` faylini oching va quyidagilarni to'ldiring:

```env
BOT_TOKEN=SizningMasterBotTokeningiz
MONGODB_URI=mongodb+srv://...
SUPER_ADMIN_IDS=SizningTelegramIDingiz
TOKEN_ENCRYPTION_KEY=32_belgidan_iborat_maxfiy_kalit
```

Telegram ID'ingizni bilish uchun [@userinfobot](https://t.me/userinfobot) ga yozing.

### 3. Ishga tushirish (lokal, polling rejimi)

`.env` faylida:
```env
USE_WEBHOOK=false
```

So'ngra:
```bash
npm start
```

### 4. Render.com'ga deploy qilish (webhook rejimi)

1. Loyihani GitHub repositoryga yuklang.
2. Render.com'da yangi **Web Service** yarating va repositoryni ulang.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment Variables bo'limida `.env.example` dagi barcha o'zgaruvchilarni kiriting.
6. `BASE_URL` ga Render bergan URL manzilini yozing (masalan `https://sizning-app.onrender.com`).
7. `USE_WEBHOOK=true` qilib qo'ying.
8. Deploy qilingandan so'ng master bot avtomatik webhook rejimida ishga tushadi.

### 5. PM2 bilan production boshqaruvi (ixtiyoriy, VPS uchun)

```bash
npm install -g pm2
npm run pm2:start
npm run pm2:logs
```

## 🔑 Birinchi admin sifatida ishlash

`SUPER_ADMIN_IDS` ga qo'shilgan Telegram ID'lar avtomatik ravishda to'liq admin huquqiga ega bo'ladi — qo'shimcha sozlash shart emas. Botga `/admin` buyrug'ini yuboring.

## 👥 Referal tizimi qanday ishlaydi

1. Har bir foydalanuvchi o'ziga xos referal havolaga ega bo'ladi (`👥 Referallar` bo'limida ko'rinadi).
2. Yangi foydalanuvchi shu havola orqali `/start` bossa va barcha majburiy kanallarga obuna bo'lsa, referal hisoblanadi.
3. Admin panel orqali kerakli referal sonini o'zgartirish mumkin (standart: 20 ta referal = 1 ta bot).
4. Kerakli son to'planganda foydalanuvchiga avtomatik 1 ta bepul bot yaratish krediti beriladi.

## 📦 Yangi shablon qo'shish

`templates.js` faylidagi `TEMPLATES` obyektiga yangi kalit qo'shish orqali istalgan yangi bot turini qo'shishingiz mumkin — tizim to'liq kengaytiriladigan qilib qurilgan.

## 🛡 Xavfsizlik

- Bot tokenlari bazada AES-256-CBC bilan shifrlangan holda saqlanadi.
- Har bir foydalanuvchi uchun rate-limit va flood-protection ishlaydi.
- Barcha kiritilgan ma'lumotlar (token, kanal, matn) validatsiyadan o'tadi.

## ❗️ Muhim eslatma

Ushbu platformada hech qanday pullik, coin yoki premium tizim yo'q. Bot yaratish butunlay bepul — yagona shart: **majburiy obuna** va **admin belgilagan referal soni**.

## 📄 Litsenziya

MIT
