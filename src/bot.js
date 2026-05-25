// © 2025 MirKa Digital. Барлық құқықтар қорғалған.
// ҚР «Авторлық құқық және сабақтас құқықтар туралы» Заңымен қорғалған.
// Кодты көшіруге, тарқатуға немесе өзгертуге тыйым салынады.
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db = require('./database');
const { handleReceipt } = require('./receiptProcessor');
const services = require('./services');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not set');

const MANAGER_USERNAME = process.env.MANAGER_USERNAME || '@manager';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID || '';
const KASPI_PAYMENT_URL = process.env.KASPI_PAYMENT_URL || 'https://kaspi.kz/pay/';

// ─── Мәтіндер (KZ / RU) ──────────────────────────────────────────────────────

const TEXTS = {
  kz: {
    welcome:
      `Сәлем! 👋 Ermek Coach ботына қош келдіңіз!\n\n` +
      `«Адамдардың көпшілігі не істеу керектігін білмегендіктен емес,\n` +
      `өздерінің кім екенін білмегендіктен тұрып қалады.»\n\n` +
      `Егер сен:\n` +
      `😔 Іске асырылмаған мүмкіндіктер бар екенін сезсең\n` +
      `🔄 Бір жерде тұрып қалғандай болсаң\n` +
      `💼 Бизнесіңді немесе өміріңді жаңа деңгейге шығарғың келсе\n\n` +
      `Бұл гайд — саған арналған.\n\n` +
      `📖 Бағасы: 23 000 ₸\n\n` +
      `👇 Толығырақ білу үшін түймені бас:`,

    details:
      `📚 *«Өзіңді тану — Бизнесті өсіру» Гайд*\n\n` +
      `Бұл гайд не береді:\n\n` +
      `🔷 Қазіргі жағдайыңды анық бағалау — өзіңе, бизнесіңе, қарым-қатынасыңа шынайы көзбен қарау\n` +
      `🔷 Не кедергі болып тұрғанын анықтау — шектеуші сенімдер, қорқыныштар, байқалмаған соқыр нүктелер\n` +
      `🔷 Алға жылжудың нақты жолы — SYTSAI әдісімен мақсатыңа жетудің қадамдық жоспары\n` +
      `🔷 Ішкі кедергілер сыртқы нәтижелерге қалай әсер ететінін түсіну\n` +
      `🔷 Мотивацияға емес, өзіңді тануға негізделген даму стратегиясы\n\n` +
      `💰 Бағасы: *23 000 ₸* (бір реттік төлем)\n\n` +
      `🎯 Гайдты оқығаннан кейін:\n` +
      `✅ Не ұстап тұрғанын нақты білесің\n` +
      `✅ Алға жылжудың жеке жоспары болады\n` +
      `✅ Толық коучинг бағдарламасына дайын боласың\n\n` +
      `👇 Сатып алу үшін түймені бас:`,

    payment:
      `💳 Төлем нұсқауы:\n\n` +
      `1️⃣ Kaspi арқылы аударма жасаңыз — төмендегі түймені басыңыз\n` +
      `💰 Сома: *23 000 ₸*\n\n` +
      `2️⃣ Төлем жасағаннан кейін Kaspi-ден PDF чекті жүктеп алыңыз\n\n` +
      `3️⃣ PDF чекті осы ботқа жіберіңіз 📎\n\n` +
      `4️⃣ Гайд автоматты түрде жіберіледі ✅\n\n` +
      `💡 PDF чекті қалай жүктеуге болады:\n` +
      `Kaspi қосымшасы → Төлем тарихы → Аударманы тап → «Чек жүктеу» → PDF файлды ботқа жібер\n\n` +
      `❓ Сұрақтарыңыз болса — жазыңыз:`,

    ask: `❓ Сұрақтарыңыз болса, менеджерге жазыңыз:\n\n👤 ${MANAGER_USERNAME}`,
    btnDetails: '📚 Гайд туралы толығырақ',
    btnBuy: '🔴 САТЫП АЛУ — 23 000 ₸',
    btnAsk: '❓ Сұрақ қою',
    btnBack: '◀️ Артқа',
    notReceipt: 'Файл жіберілді, бірақ чек ретінде танылмады.\n\nKaspi-ден жүктелген PDF файлды жіберіңіз.',
    startHint: 'Ботты қолдану үшін /start командасын жіберіңіз.',
    checking: 'Чекті тексеруімін... ⏳',
    downloadError: 'Файлды жүктеу кезінде қате болды. Қайтадан жіберіп көріңіз.',
    wrongMerchant: 'Бұл чек біздің шотқа жатпайды. Дұрыс чекті жіберіңіз.',
    expired: 'Бұл чектің мерзімі өткен (24 сағаттан астам). Жаңа чекті жіберіңіз.',
    duplicate: 'Бұл чек бұрын қолданылған.',
    insufficientAmount: (price, paid) => `Төлем сомасы жеткіліксіз. Гайдтың бағасы: ${price} ₸. Сіздің төлеміңіз: ${paid} ₸.`,
    dbError: 'Деректер базасына сақтау кезінде қате болды. Менеджерге хабарлаңыз.',
    paymentConfirmed: 'Төлем расталды! ✅ Жіберілуде...',
    guideNotFound: 'Рахмет! Гайдыңыз дайындалуда, жақында жіберіледі. 🎉',
    guideCaption: 'Рахмет! Гайдыңыз осында 🎉 Сәттілік тілейміз!',
    sendError: 'Жіберу кезінде қате болды. Менеджерге хабарлаңыз.',
    managerContact: 'Рахмет! Менеджер жақын арада байланысады. 🎉',
  },

  ru: {
    welcome:
      `Привет! 👋 Добро пожаловать в бот Ermek Coach!\n\n` +
      `«Большинство людей останавливаются не потому, что не знают, что делать,\n` +
      `а потому что не знают, кто они есть.»\n\n` +
      `Если ты:\n` +
      `😔 Чувствуешь нереализованный потенциал\n` +
      `🔄 Ощущаешь, что стоишь на месте\n` +
      `💼 Хочешь вывести бизнес или жизнь на новый уровень\n\n` +
      `Этот гайд — для тебя.\n\n` +
      `📖 Цена: 23 000 ₸\n\n` +
      `👇 Нажмите кнопку для подробностей:`,

    details:
      `📚 *Гайд «Познай себя — Развивай бизнес»*\n\n` +
      `Что даёт этот гайд:\n\n` +
      `🔷 Честная оценка текущей ситуации — себя, бизнеса, отношений\n` +
      `🔷 Найти, что мешает — ограничивающие убеждения, страхи, слепые пятна\n` +
      `🔷 Чёткий путь вперёд — пошаговый план по методу SYTSAI\n` +
      `🔷 Понять, как внутренние блоки влияют на внешние результаты\n` +
      `🔷 Стратегия развития, основанная на самопознании, а не мотивации\n\n` +
      `💰 Цена: *23 000 ₸* (единоразово)\n\n` +
      `🎯 После прочтения гайда:\n` +
      `✅ Точно знаешь, что тебя держит\n` +
      `✅ Есть личный план движения вперёд\n` +
      `✅ Готов к полной программе коучинга\n\n` +
      `👇 Нажмите для покупки:`,

    payment:
      `💳 Инструкция по оплате:\n\n` +
      `1️⃣ Переведите через Kaspi — нажмите кнопку ниже\n` +
      `💰 Сумма: *23 000 ₸*\n\n` +
      `2️⃣ После оплаты скачайте PDF чек из Kaspi\n\n` +
      `3️⃣ Отправьте PDF чек в этот бот 📎\n\n` +
      `4️⃣ Гайд отправится автоматически ✅\n\n` +
      `💡 Как скачать PDF чек:\n` +
      `Приложение Kaspi → История → Найдите перевод → «Скачать чек» → PDF в бот\n\n` +
      `❓ Есть вопросы — пишите:`,

    ask: `❓ Есть вопросы? Напишите менеджеру:\n\n👤 ${MANAGER_USERNAME}`,
    btnDetails: '📚 Подробнее о гайде',
    btnBuy: '🔴 КУПИТЬ — 23 000 ₸',
    btnAsk: '❓ Задать вопрос',
    btnBack: '◀️ Назад',
    notReceipt: 'Файл получен, но не распознан как чек.\n\nОтправьте PDF чек, скачанный из Kaspi.',
    startHint: 'Отправьте /start чтобы начать.',
    checking: 'Проверяю чек... ⏳',
    downloadError: 'Ошибка загрузки файла. Попробуйте отправить ещё раз.',
    wrongMerchant: 'Этот чек не относится к нашему счёту. Отправьте правильный чек.',
    expired: 'Срок действия чека истёк (более 24 часов). Отправьте новый чек.',
    duplicate: 'Этот чек уже был использован.',
    insufficientAmount: (price, paid) => `Сумма оплаты недостаточна. Цена гайда: ${price} ₸. Ваш платёж: ${paid} ₸.`,
    dbError: 'Ошибка сохранения в базу данных. Напишите менеджеру.',
    paymentConfirmed: 'Оплата подтверждена! ✅ Отправляю...',
    guideNotFound: 'Спасибо! Гайд готовится, скоро будет отправлен. 🎉',
    guideCaption: 'Спасибо! Ваш гайд здесь 🎉 Желаем успехов!',
    sendError: 'Ошибка при отправке. Напишите менеджеру.',
    managerContact: 'Спасибо! Менеджер свяжется с вами в ближайшее время. 🎉',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const userServiceChoice = new Map();
const userLang = new Map();

const getLang = (userId) => userLang.get(userId) || 'kz';
const t = (userId) => TEXTS[getLang(userId)];

const bot = new Telegraf(BOT_TOKEN);

// /start — тіл таңдау
bot.start(async (ctx) => {
  await ctx.reply(
    '🇰🇿 Тілді таңдаңыз\n🇷🇺 Выберите язык',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🇰🇿 Қазақша', 'lang_kz'),
        Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      ],
    ])
  );
});

// Тіл таңдалды
bot.action('lang_kz', async (ctx) => {
  await ctx.answerCbQuery();
  userLang.set(ctx.from.id, 'kz');
  const txt = t(ctx.from.id);
  await ctx.reply(txt.welcome, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(txt.btnDetails, 'details')],
    ]),
  });
});

bot.action('lang_ru', async (ctx) => {
  await ctx.answerCbQuery();
  userLang.set(ctx.from.id, 'ru');
  const txt = t(ctx.from.id);
  await ctx.reply(txt.welcome, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(txt.btnDetails, 'details')],
    ]),
  });
});

// Толығырақ — гайд
bot.action('details', async (ctx) => {
  await ctx.answerCbQuery();
  const txt = t(ctx.from.id);
  await ctx.reply(txt.details, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(txt.btnBuy, 'buy_guide')],
      [Markup.button.callback(txt.btnAsk, 'ask')],
    ]),
  });
});

// Гайд сатып алу
bot.action('buy_guide', async (ctx) => {
  await ctx.answerCbQuery();
  userServiceChoice.set(ctx.from.id, 'guide');
  const txt = t(ctx.from.id);
  await ctx.reply(txt.payment, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.url('🔴 KASPI PAY — 23 000 ₸', KASPI_PAYMENT_URL)],
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
  const txt = t(ctx.from.id);
  const buttons = Object.values(services).map(s => [
    Markup.button.callback(
      `${s.emoji} ${s.name} — ${s.price.toLocaleString('ru-KZ')} ₸`,
      `svc_${s.id}`
    ),
  ]);
  buttons.push([Markup.button.callback(txt.btnAsk, 'ask')]);

  await ctx.reply(`🛍 Қызметтер / Услуги`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

// Қызмет таңдалды
Object.values(services).forEach(service => {
  bot.action(`svc_${service.id}`, async (ctx) => {
    await ctx.answerCbQuery();
    const txt = t(ctx.from.id);
    await ctx.reply(service.details, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(
          `💳 ${service.price.toLocaleString('ru-KZ')} ₸`,
          `buy_${service.id}`
        )],
        [Markup.button.callback(txt.btnBack, 'show_services')],
        [Markup.button.callback(txt.btnAsk, 'ask')],
      ]),
    });
  });

  bot.action(`buy_${service.id}`, async (ctx) => {
    await ctx.answerCbQuery();
    userServiceChoice.set(ctx.from.id, service.id);
    await ctx.reply(service.payment, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🔴 KASPI PAY', service.kaspiUrl || KASPI_PAYMENT_URL)],
      ]),
    });
  });
});

// Сұрақ қою
bot.action('ask', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(t(ctx.from.id).ask);
});

// Фото немесе PDF — чек тексеру + менеджерге жіберу
bot.on(['photo', 'document'], async (ctx) => {
  const user = ctx.from;
  const serviceId = userServiceChoice.get(user.id) || 'guide';
  const txt = t(user.id);

  // Менеджерге хабарды жіберу
  if (MANAGER_CHAT_ID) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const username = user.username ? ` (@${user.username})` : '';
    const fileType = ctx.message.photo ? '📷 Фото' : '📄 PDF';
    try {
      await bot.telegram.sendMessage(
        MANAGER_CHAT_ID,
        `📩 Жаңа файл:\n👤 ${name}${username} [${user.id}]\n${fileType} жіберді`
      );
      await ctx.forwardMessage(MANAGER_CHAT_ID);
    } catch {}
  }

  const handled = await handleReceipt(bot, ctx, serviceId, txt);
  if (!handled) {
    await ctx.reply(txt.notReceipt);
  } else {
    userServiceChoice.delete(user.id);
  }
});

// Басқа хабарлар — менеджерге жібер
bot.on('message', async (ctx) => {
  const msg = ctx.message;
  const user = ctx.from;
  const txt = t(user.id);

  if (MANAGER_CHAT_ID && msg.text) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const username = user.username ? ` (@${user.username})` : '';
    try {
      await bot.telegram.sendMessage(
        MANAGER_CHAT_ID,
        `📩 Жаңа хабар:\n👤 ${name}${username} [${user.id}]\n\n💬 ${msg.text}`
      );
    } catch {}
  }

  await ctx.reply(txt.startHint, Markup.inlineKeyboard([
    [Markup.button.callback(txt.btnDetails, 'details')],
  ]));
});

async function main() {
  await db.init();
  // Wait for any previous instance to shut down before polling
  console.log('[bot] waiting for previous instance to stop...');
  await new Promise(r => setTimeout(r, 12000));
  console.log('[bot] starting...');
  try { await bot.telegram.deleteWebhook({ drop_pending_updates: true }); } catch {}
  await bot.launch({ dropPendingUpdates: true });
  console.log('[bot] running');
}

main().catch((err) => {
  console.error('[bot] fatal error:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
