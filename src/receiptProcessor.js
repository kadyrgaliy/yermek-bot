const jsQR = require('jsqr');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const db = require('./database');

const GUIDE_PRICE = parseFloat(process.env.GUIDE_PRICE || '5000');
const MERCHANT_IIN = process.env.MERCHANT_IIN || '';
const GUIDE_PDF_PATH = process.env.GUIDE_PDF_PATH || './guide.pdf';

/**
 * Handle incoming photo or PDF document — check if it's a Kaspi receipt.
 * Returns true if handled (whether success or failure), false if not a receipt.
 */
async function handleReceipt(bot, ctx, serviceId = 'guide') {
  const msg = ctx.message;
  const chatId = msg.chat.id;

  // Determine file_id and mime_type
  let fileId, mimeType;
  if (msg.photo && msg.photo.length > 0) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    mimeType = 'image/jpeg';
  } else if (msg.document && msg.document.mime_type === 'application/pdf') {
    fileId = msg.document.file_id;
    mimeType = 'application/pdf';
  } else {
    return false;
  }

  // Send ack immediately
  const ack = await ctx.reply('Чекті тексеруімін... ⏳');
  const ackMsgId = ack.message_id;

  const editAck = async (text) => {
    try {
      await bot.telegram.editMessageText(chatId, ackMsgId, null, text);
    } catch {
      await ctx.reply(text);
    }
  };

  // Download file buffer
  let buffer;
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const res = await fetch(fileLink.href);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('[receipt] download error:', err.message);
    await editAck('Файлды жүктеу кезінде қате болды. Қайтадан жіберіп көріңіз.');
    return true;
  }

  // Parse receipt — PDF: text parsing, Photo: QR code
  let receiptData;
  try {
    console.log('[receipt] processing, mimeType:', mimeType, 'size:', buffer.length);
    if (mimeType === 'application/pdf') {
      receiptData = await parsePdfReceipt(buffer);
    } else {
      receiptData = await parsePhotoReceipt(buffer);
    }
    console.log('[receipt] parsed:', receiptData);
  } catch (err) {
    console.error('[receipt] parse error:', err.message);
  }

  if (!receiptData) {
    try { await bot.telegram.deleteMessage(chatId, ackMsgId); } catch {}
    return false;
  }

  // Validate: merchant IIN
  if (MERCHANT_IIN && receiptData.iin !== MERCHANT_IIN) {
    await editAck('Бұл чек біздің шотқа жатпайды. Дұрыс чекті жіберіңіз.');
    return true;
  }

  // Validate: freshness (24h)
  if (receiptData.receiptDate) {
    const ageMs = Date.now() - receiptData.receiptDate.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await editAck('Бұл чектің мерзімі өткен (24 сағаттан астам). Жаңа чекті жіберіңіз.');
      return true;
    }
  }

  // Validate: duplicate
  const existing = await db.findReceipt(receiptData.receipt_id);
  if (existing) {
    await editAck('Бұл чек бұрын қолданылған.');
    return true;
  }

  // Validate: amount
  if (parseFloat(receiptData.amount) < GUIDE_PRICE) {
    await editAck(
      `Төлем сомасы жеткіліксіз. Гайдтың бағасы: ${GUIDE_PRICE.toLocaleString('ru-KZ')} ₸. ` +
      `Сіздің төлеміңіз: ${parseFloat(receiptData.amount).toLocaleString('ru-KZ')} ₸.`
    );
    return true;
  }

  // Save receipt
  try {
    await db.saveReceipt({
      telegramId: chatId,
      receiptId: receiptData.receipt_id,
      serviceId,
      iin: receiptData.iin,
      amount: receiptData.amount,
      paymentMethod: receiptData.payment_method,
      receiptDatetime: receiptData.receiptDate,
      qrUrl: receiptData.qrUrl || null,
      rawData: receiptData.raw_data || {},
    });
  } catch (err) {
    console.error('[receipt] DB save error:', err.message);
    await editAck('Деректер базасына сақтау кезінде қате болды. Менеджерге хабарлаңыз.');
    return true;
  }

  // Success — deliver content
  await editAck('Төлем расталды! ✅ Жіберілуде...');
  await deliverService(bot, chatId, serviceId);
  return true;
}

async function deliverService(bot, chatId, serviceId) {
  const fs = require('fs');
  const services = require('./services');

  // Guide (PDF гайд) — default
  if (serviceId === 'guide') {
    try {
      if (!fs.existsSync(GUIDE_PDF_PATH)) {
        await bot.telegram.sendMessage(chatId, 'Рахмет! Гайдыңыз дайындалуда, жақында жіберіледі. 🎉');
        console.warn('[receipt] PDF not found at:', GUIDE_PDF_PATH);
        return;
      }
      await bot.telegram.sendDocument(chatId, { source: GUIDE_PDF_PATH }, {
        caption: 'Рахмет! Гайдыңыз осында 🎉 Сәттілік тілейміз!',
      });
    } catch (err) {
      console.error('[receipt] PDF send error:', err.message);
      await bot.telegram.sendMessage(chatId, 'Жіберу кезінде қате болды. Менеджерге хабарлаңыз.');
    }
    return;
  }

  // Басқа қызметтер
  const service = services[serviceId];
  if (!service) {
    await bot.telegram.sendMessage(chatId, 'Рахмет! Менеджер жақын арада байланысады. 🎉');
    return;
  }

  try {
    if (service.deliveryType === 'file' && service.filePath && fs.existsSync(service.filePath)) {
      await bot.telegram.sendDocument(chatId, { source: service.filePath }, {
        caption: service.deliveryText || 'Рахмет! 🎉',
        parse_mode: 'Markdown',
      });
    } else {
      await bot.telegram.sendMessage(chatId, service.deliveryText || 'Рахмет! 🎉', {
        parse_mode: 'Markdown',
      });
    }
  } catch (err) {
    console.error('[receipt] delivery error:', err.message);
    await bot.telegram.sendMessage(chatId, 'Жіберу кезінде қате болды. Менеджерге хабарлаңыз.');
  }
}

// Parse Kaspi Pay PDF receipt by extracting text
async function parsePdfReceipt(pdfBuffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map(i => i.str).join(' ');
  console.log('[receipt] PDF text:', text.substring(0, 500));

  // Receipt ID: "Түбіртек № QR12345678"
  const receiptIdMatch = text.match(/Түбіртек\s*№\s*(QR\d+|\d+)/i);
  if (!receiptIdMatch) {
    console.log('[receipt] no receipt ID found in PDF text');
    return null;
  }

  // Amount: "Төлем жасалды 4 990 ₸" or "1 ₸"
  const amountMatch = text.match(/Төлем жасалды\s+([\d\s]+)\s*₸/);
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/\s/g, ''))
    : null;

  // Seller IIN: "Сатушының ЖСН/БСН 670723400769"
  const iinMatch = text.match(/Сатушының\s+ЖСН\/БСН\s+(\d+)/);

  // Date: "Күні мен уақыты (Астана) 25.05.2026 00:51"
  const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/);
  let receiptDate = null;
  if (dateMatch) {
    const [, date, time] = dateMatch;
    const [day, month, year] = date.split('.');
    receiptDate = new Date(`${year}-${month}-${day}T${time}:00`);
  }

  // Payment method: "Төленді Kaspi Gold"
  const methodMatch = text.match(/Төленді\s+(Kaspi\s+\w+)/i);

  return {
    receipt_id: receiptIdMatch[1],
    iin: iinMatch ? iinMatch[1] : '',
    amount: amount,
    payment_method: methodMatch ? methodMatch[1] : '',
    receiptDate,
    raw_data: { text },
  };
}

// Parse photo receipt by reading QR code
async function parsePhotoReceipt(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code = jsQR(new Uint8ClampedArray(data.buffer), info.width, info.height);
  if (!code || !code.data.includes('kaspi.kz')) {
    console.log('[receipt] no Kaspi QR in photo');
    return null;
  }

  console.log('[receipt] QR URL from photo:', code.data);
  const kaspiParser = require('./kaspiParser');
  const parsed = await kaspiParser.parse(code.data);
  const receiptDate = kaspiParser.parseDateTime(parsed.datetime);
  return {
    receipt_id: parsed.receipt_id,
    iin: parsed.iin,
    amount: parsed.amount,
    payment_method: parsed.payment_method,
    receiptDate,
    qrUrl: code.data,
    raw_data: parsed.raw_data,
  };
}

module.exports = { handleReceipt };
