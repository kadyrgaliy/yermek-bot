const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id               SERIAL PRIMARY KEY,
      telegram_id      BIGINT NOT NULL,
      receipt_id       TEXT NOT NULL UNIQUE,
      service_id       TEXT,
      iin              TEXT,
      amount           DECIMAL(12,2),
      payment_method   TEXT,
      receipt_datetime TIMESTAMP,
      qr_url           TEXT,
      raw_data         JSONB,
      created_at       TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS service_id TEXT;
  `).catch(() => {});
  console.log('[db] receipts table ready');
}

async function findReceipt(receiptId) {
  const res = await pool.query('SELECT id FROM receipts WHERE receipt_id = $1', [receiptId]);
  return res.rows[0] || null;
}

async function saveReceipt({ telegramId, receiptId, serviceId, iin, amount, paymentMethod, receiptDatetime, qrUrl, rawData }) {
  await pool.query(
    `INSERT INTO receipts (telegram_id, receipt_id, service_id, iin, amount, payment_method, receipt_datetime, qr_url, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [telegramId, receiptId, serviceId || null, iin, amount, paymentMethod, receiptDatetime, qrUrl, JSON.stringify(rawData)]
  );
}

module.exports = { init, findReceipt, saveReceipt };
