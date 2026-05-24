/**
 * Fetch a Kaspi receipt page by QR URL and parse payment data from __NUXT_DATA__.
 *
 * Kaspi receipt pages embed a <script id="__NUXT_DATA__"> tag containing a JSON array.
 * Instead of relying on fixed indices (which change), we search by known field names/patterns.
 */

async function parse(qrUrl) {
  const response = await fetch(qrUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Kaspi receipt fetch failed: ${response.status}`);
  }

  const html = await response.text();

  // Extract __NUXT_DATA__ script content
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find __NUXT_DATA__ script tag');
  }

  let nuxtData;
  try {
    nuxtData = JSON.parse(match[1]);
  } catch (e) {
    throw new Error('Failed to parse __NUXT_DATA__ JSON');
  }

  // Find the main data object â€” look for the object with "amount" and "extTranId" keys
  const data = findDataObject(nuxtData);

  const amount = data.amount;
  if (!amount || isNaN(amount)) {
    throw new Error(`Could not find amount in receipt data`);
  }

  // receipt_id is extTranId (e.g. "QR12992816084")
  const receiptId = data.extTranId;
  if (!receiptId) {
    throw new Error('Could not find receipt ID (extTranId)');
  }

  // Find payment method from payParameters â€” look for "ÐžÐ¿Ð»Ð°Ñ‡ÐµÐ½Ð¾" field
  const paymentMethod = findPaymentMethod(nuxtData, data);

  // Find seller IIN from payParameters â€” look for "Ð˜Ð˜Ð/Ð‘Ð˜Ð Ð¿Ñ€Ð¾Ð´Ð°Ð²Ñ†Ð°"
  const sellerIIN = findFieldValue(nuxtData, data, 'Ð˜Ð˜Ð/Ð‘Ð˜Ð Ð¿Ñ€Ð¾Ð´Ð°Ð²Ñ†Ð°');

  // client_iin is the buyer's IIN
  const clientIIN = data.client_iin ? resolve(nuxtData, data.client_iin) : null;

  // saleDate for datetime
  const saleDate = data.saleDate ? resolve(nuxtData, data.saleDate) : null;

  // Find datetime from payParameters â€” "Ð”Ð°Ñ‚Ð° Ð¸ Ð²Ñ€ÐµÐ¼Ñ Ð¿Ð¾ ÐÑÑ‚Ð°Ð½Ðµ"
  const datetime = findFieldValue(nuxtData, data, 'Ð”Ð°Ñ‚Ð° Ð¸ Ð²Ñ€ÐµÐ¼Ñ');

  console.log('[kaspi] parsed:', { receiptId, amount, sellerIIN, clientIIN, paymentMethod, datetime: datetime || saleDate });

  return {
    receipt_id: receiptId,
    iin: sellerIIN || '',
    client_iin: clientIIN || '',
    amount,
    datetime: datetime || saleDate || '',
    payment_method: paymentMethod || '',
    raw_data: nuxtData,
  };
}

/**
 * Resolve a value from nuxtData â€” if it's an index reference, follow it.
 */
function resolve(nuxtData, val) {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < nuxtData.length) {
    return nuxtData[val];
  }
  return val;
}

/**
 * Find the main receipt data object in the nuxtData array.
 * It has keys like amount, extTranId, payParameters, etc.
 */
function findDataObject(nuxtData) {
  for (const item of nuxtData) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if ('amount' in item && 'extTranId' in item) {
        // Resolve all values
        const resolved = {};
        for (const [key, val] of Object.entries(item)) {
          resolved[key] = resolve(nuxtData, val);
        }
        return resolved;
      }
    }
  }
  throw new Error('Could not find receipt data object in __NUXT_DATA__');
}

/**
 * Find payment method by looking for "ÐžÐ¿Ð»Ð°Ñ‡ÐµÐ½Ð¾" in payParameters.
 */
function findPaymentMethod(nuxtData, data) {
  return findFieldValue(nuxtData, data, 'ÐžÐ¿Ð»Ð°Ñ‡ÐµÐ½Ð¾');
}

/**
 * Search payParameters for a field by name and return its value.
 * payParameters is an array of indices pointing to {name, value} objects.
 */
function findFieldValue(nuxtData, data, fieldName) {
  // data.payParameters should be resolved to an array of indices
  if (!data.payParameters) return null;

  // payParameters might be an index to an array
  let params = data.payParameters;
  if (typeof params === 'number') {
    params = nuxtData[params];
  }
  if (!Array.isArray(params)) return null;

  for (const idx of params) {
    const obj = typeof idx === 'number' ? nuxtData[idx] : idx;
    if (!obj || typeof obj !== 'object') continue;

    const name = resolve(nuxtData, obj.name);
    const value = resolve(nuxtData, obj.value);

    if (typeof name === 'string' && name.includes(fieldName)) {
      return value;
    }
  }
  return null;
}

/**
 * Parse Kaspi datetime string "DD.MM.YYYY HH:mm" into a Date object.
 */
function parseDateTime(datetimeStr) {
  if (!datetimeStr) return null;
  const match = datetimeStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  return new Date(`${year}-${month}-${day}T${hours}:${minutes}:00`);
}

/**
 * Calculate net amount after bank commission + 3% tax.
 */
function calculateNetAmount(amount, paymentMethod) {
  const method = (paymentMethod || '').toLowerCase();

  let commission = 0;
  if (method.includes('kaspi red')) {
    commission = 0.0095 + 0.1155;
  } else if (method.includes('kaspi kredit') || method.includes('kaspi ÐºÑ€ÐµÐ´Ð¸Ñ‚')) {
    commission = 0.0095 + 0.1405;
  } else if (method.includes('kaspi gold') || method.includes('kaspi pay')) {
    commission = 0.0095;
  } else if (method.includes('Ð½Ð°Ð»Ð¸Ñ‡Ð½Ñ‹Ð¼Ð¸') || method.includes('Ò›Ð¾Ð»Ð¼Ð°-Ò›Ð¾Ð»')) {
    commission = 0;
  } else {
    commission = 0.0095;
  }

  const afterCommission = amount - amount * commission;
  const netAmount = afterCommission * 0.97;
  return Math.round(netAmount);
}

module.exports = { parse, parseDateTime, calculateNetAmount };