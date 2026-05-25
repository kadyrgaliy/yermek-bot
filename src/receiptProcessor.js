const jsQR = require('jsqr');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const db = require('./database');

const GUIDE_PRICE = parseFloat(process.env.GUIDE_PRICE || '23000');
const MERCHANT_IIN = process.env.MERCHANT_IIN || '';
const GUIDE_PDF_PATH = process.env.GUIDE_PDF_PATH || './guide.pdf';

async function handleReceipt(bot, ctx, serviceId = 'guide', txt = {}) {
  const msg = ctx.message;
  const chatId = msg.chat.id;

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

  const ack = await ctx.reply(txt.checking || 'Чекті тексеруімін... ⏳');
  const ackMsgId = ack.message_id;

  const editAck = async (text) => {
    try {
      await bot.telegram.editMessageText(chatId, ackMsgId, null, text);
    } catch {
      await ctx.reply(text);
    }
  };

  let buffer;
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const res = await fetch(fileLink.href);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('[receipt] download error:', err.message);
    await editAck(txt.downloadError || 'Файлды жүктеу кезінде қате болды. Қайтадан жіберіп көріңіз.');
    return true;
  }

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

  if (MERCHANT_IIN && receiptData.iin !== MERCHANT_IIN) {
    await editAck(txt.wrongMerchant || 'Бұл чек біздің шотқа жатпайды. Дұрыс чекті жіберіңіз.');
    return true;
  }

  if (receiptData.receiptDate) {
    const ageMs = Date.now() - receiptData.receiptDate.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await editAck(txt.expired || 'Бұл чектің мерзімі өткен (24 сағаттан астам). Жаңа чекті жіберіңіз.');
      return true;
    }
  }

  const existing = await db.findReceipt(receiptData.receipt_id);
  if (existing) {
    await editAck(txt.duplicate || 'Бұл чек бұрын қолданылған.');
    return true;
  }

  if (parseFloat(receiptData.amount) < GUIDE_PRICE) {
    const price = GUIDE_PRICE.toLocaleString('ru-KZ');
    const paid = parseFloat(receiptData.amount).toLocaleString('ru-KZ');
    const message = typeof txt.insufficientAmount === 'function'
      ? txt.insufficientAmount(price, paid)
      : `Төлем сомасы жеткіліксіз. Гайдтың бағасы: ${price} ₸. Сіздің төлеміңіз: ${paid} ₸.`;
    await editAck(message);
    return true;
  }

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
    await editAck(txt.dbError || 'Деректер базасына сақтау кезінде қате болды. Менеджерге хабарлаңыз.');
    return true;
  }

  await editAck(txt.paymentConfirmed || 'Төлем расталды! ✅ Жіберілуде...');
  await deliverService(bot, chatId, serviceId, txt);
  return true;
}

async function deliverService(bot, chatId, serviceId, txt = {}) {
  const fs = require('fs');
  const services = require('./services');

  if (serviceId === 'guide') {
    try {
      if (!fs.existsSync(GUIDE_PDF_PATH)) {
        await bot.telegram.sendMessage(chatId, txt.guideNotFound || 'Рахмет! Гайдыңыз дайындалуда, жақында жіберіледі. 🎉');
        console.warn('[receipt] PDF not found at:', GUIDE_PDF_PATH);
        return;
      }
      await bot.telegram.sendDocument(chatId, { source: GUIDE_PDF_PATH }, {
        caption: txt.guideCaption || 'Рахмет! Гайдыңыз осында 🎉 Сәттілік тілейміз!',
      });
    } catch (err) {
      console.error('[receipt] PDF send error:', err.message);
      await bot.telegram.sendMessage(chatId, txt.sendError || 'Жіберу кезінде қате болды. Менеджерге хабарлаңыз.');
    }
    return;
  }

  const service = services[serviceId];
  if (!service) {
    await bot.telegram.sendMessage(chatId, txt.managerContact || 'Рахмет! Менеджер жақын арада байланысады. 🎉');
    return;
  }

  try {
    if (service.deliveryType === 'file' && service.filePath && fs.existsSync(service.filePath)) {
      await bot.telegram.sendDocument(chatId, { source: service.filePath }, {
        caption: service.deliveryText || txt.guideCaption || 'Рахмет! 🎉',
        parse_mode: 'Markdown',
      });
    } else {
      await bot.telegram.sendMessage(chatId, service.deliveryText || txt.managerContact || 'Рахмет! 🎉', {
        parse_mode: 'Markdown',
      });
    }
  } catch (err) {
    console.error('[receipt] delivery error:', err.message);
    await bot.telegram.sendMessage(chatId, txt.sendError || 'Жіберу кезінде қате болды. Менеджерге хабарлаңыз.');
  }
}

async function parsePdfReceipt(pdfBuffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map(i => i.str).join(' ');
  console.log('[receipt] PDF text:', text.substring(0, 500));

  const receiptIdMatch = text.match(/Түбіртек\s*№\s*(QR\d+|\d+)/i);
  if (!receiptIdMatch) {
    console.log('[receipt] no receipt ID found in PDF text');
    return null;
  }

  const amountMatch = text.match(/Төлем жасалды\s+([\d\s]+)\s*₸/);
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/\s/g, ''))
    : null;

  const iinMatch = text.match(/Сатушының\s+ЖСН\/БСН\s+(\d+)/);

  const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/);
  let receiptDate = null;
  if (dateMatch) {
    const [, date, time] = dateMatch;
    const [day, month, year] = date.split('.');
    receiptDate = new Date(`${year}-${month}-${day}T${time}:00`);
  }

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
