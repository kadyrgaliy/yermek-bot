require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db = require('./database');
const { handleReceipt } = require('./receiptProcessor');
const services = require('./services');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not set');

const MANAGER_USERNAME = process.env.MANAGER_USERNAME || '@manager';
const KASPI_PAYMENT_URL = process.env.KASPI_PAYMENT_URL || 'https://kaspi.kz/pay/';

// ─── Мәтіндер ────────────────────────────────────────────────────────────────

const TEXT_WELCOME = `Сәлем! 👋 Ermek Coach ботына қош келдіңіз!

«Адамдардың көпшілігі не істеу керектігін білмегендіктен емес,
өздерінің кім екенін білмегендіктен тұрып қалады.»

Егер сен:
😔 Іске асырылмаған мүмкіндіктер бар екенін сезсең
🔄 Бір жерде тұрып қалғандай болсаң
💼 Бизнесіңді немесе өміріңді жаңа деңгейге шығарғың келсе

Бұл гайд — саған арналған.

📖 Бағасы: 23 000 ₸

👇 Толығырақ білу үшін түймені бас:`;

const TEXT_DETAILS = `📚 «Өзіңді тану — Бизнесті өсіру» Гайд

Бұл гайд не береді:

🔷 Қазіргі жағдайыңды анық бағалау — өзіңе, бизнесіңе, қарым-қатынасыңа шынайы көзбен қарау

🔷 Не кедергі болып тұрғанын анықтау — шектеуші сенімдер, қорқыныштар, байқалмаған соқыр нүктелер

🔷 Алға жылжудың нақты жолы — SYTSAI әдісімен мақсатыңа жетудің қадамдық жоспары

🔷 Ішкі кедергілер сыртқы нәтижелерге қалай әсер ететінін түсіну

🔷 Мотивацияға емес, өзіңді тануға негізделген даму стратегиясы

💰 Бағасы: 23 000 ₸ (бір реттік төлем)

🎯 Гайдты оқығаннан кейін:
✅ Не ұстап тұрғанын нақты білесің
✅ Алға жылжудың жеке жоспары болады
✅ Толық коучинг бағдарламасына дайын боласың

👇 Сатып алу үшін түймені бас:`;

const TEXT_PAYMENT = `💳 Төлем нұсқауы:

1️⃣ Kaspi арқылы аударма жасаңыз — төмендегі түймені басыңыз
💰 Сома: 23 000 ₸

2️⃣ Төлем жасағаннан кейін Kaspi-ден PDF чекті жүктеп алыңыз

3️⃣ PDF чекті осы ботқа жіберіңіз 📎

4️⃣ Гайд автоматты түрде жіберіледі ✅

💡 PDF чекті қалай жүктеуге болады:
Kaspi қосымшасы → Төлем тарихы → Аударманы тап → «Чек жүктеу» түймесін бас → PDF файлды ботқа жібер

❓ Сұрақтарыңыз болса — жазыңыз:`;

const TEXT_ASK = `❓ Сұрақтарыңыз болса, менеджерге жазыңыз:\n\n👤 ${MANAGER_USERNAME}`;

// ─── Қызметтер мәзірі ────────────────────────────────────────────────────────

const TEXT_SERVICES = `🛍 *Қызметтер тізімі*\n\nҚандай қызметті алғыңыз келеді?`;

// ─────────────────────────────────────────────────────────────────────────────

const userServiceChoice = new Map();

const bot = new Telegraf(BOT_TOKEN);

// /start
bot.start(async (ctx) => {
  await ctx.reply(TEXT_WELCOME, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📚 Гайд туралы толығырақ', 'details')],
    ]),
  });
});

// Толығырақ — гайд
bot.action('details', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(TEXT_DETAILS, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('💳 Сатып алу — 23 000 ₸', 'buy_guide')],
      [Markup.button.callback('❓ Сұрақ қою', 'ask')],
    ]),
  });
});

// Гайд сатып алу
bot.action('buy_guide', async (ctx) => {
  await ctx.answerCbQuery();
  userServiceChoice.set(ctx.from.id, 'guide');
  await ctx.reply(TEXT_PAYMENT, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('💳 Kaspi Pay төлем', KASPI_PAYMENT_URL)],
    ]),
  });
});

// /services — қызметтер мәзірі
bot.command('services', async (ctx) => {
  await showServicesMenu(ctx);
});

bot.action('show_services', async (ctx) => {
  await ctx.answerCbQuery();
  await showServicesMenu(ctx);
});

async function showServicesMenu(ctx) {
  const buttons = Object.values(services).map(s => [
    Markup.button.callback(
      `${s.emoji} ${s.name} — ${s.price.toLocaleString('ru-KZ')} ₸`,
      `svc_${s.id}`
    ),
  ]);
  buttons.push([Markup.button.callback('❓ Сұрақ қою', 'ask')]);

  await ctx.reply(TEXT_SERVICES, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

// Қызмет таңдалды
Object.values(services).forEach(service => {
  bot.action(`svc_${service.id}`, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(service.details, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(
          `💳 Сатып алу — ${service.price.toLocaleString('ru-KZ')} ₸`,
          `buy_${service.id}`
        )],
        [Markup.button.callback('◀️ Артқа', 'show_services')],
        [Markup.button.callback('❓ Сұрақ қою', 'ask')],
      ]),
    });
  });

  bot.action(`buy_${service.id}`, async (ctx) => {
    await ctx.answerCbQuery();
    userServiceChoice.set(ctx.from.id, service.id);
    await ctx.reply(service.payment, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('💳 Kaspi Pay төлем', service.kaspiUrl || KASPI_PAYMENT_URL)],
      ]),
    });
  });
});

// Сұрақ қою
bot.action('ask', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(TEXT_ASK);
});

// Фото немесе PDF — чек тексеру
bot.on(['photo', 'document'], async (ctx) => {
  const serviceId = userServiceChoice.get(ctx.from.id) || 'guide';
  const handled = await handleReceipt(bot, ctx, serviceId);
  if (!handled) {
    await ctx.reply(
      'Файл жіберілді, бірақ чек ретінде танылмады.\n\n' +
      'Чекті жіберу үшін Kaspi-ден жүктелген PDF файлды жіберіңіз.'
    );
  } else {
    userServiceChoice.delete(ctx.from.id);
  }
});

// Басқа хабарлар
bot.on('message', async (ctx) => {
  await ctx.reply(
    'Ботты қолдану үшін /start командасын жіберіңіз.',
    Markup.inlineKeyboard([
      [Markup.button.callback('📖 Гайд туралы', 'details')],
      [Markup.button.callback('🛍 Басқа қызметтер', 'show_services')],
    ])
  );
});

async function main() {
  await db.init();
  console.log('[bot] starting...');
  await bot.launch({ dropPendingUpdates: true });
  console.log('[bot] running');
}

main().catch((err) => {
  console.error('[bot] fatal error:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
