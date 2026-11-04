require('dotenv').config();

const express = require('express');
const path = require('node:path');
const { Pool } = require('pg');
const handler = require('./index');

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true },
  max: 8,
  connectionTimeoutMillis: 5000,
});
const ttl = Number(process.env.RESERVATION_CLEANUP_INTERVAL_MS || 60000);

app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = process.env.BELLA_CORS_ORIGIN;
  if (origin && req.headers.origin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) => res.json({ success: true, data: { service: 'bella-api' } }));
app.all('/api/*path', (req, res) => {
  const pathParts = req.params.path;
  req._bellaPath = Array.isArray(pathParts) ? pathParts.join('/') : pathParts;
  return handler(req, res);
});
app.use(express.static(path.resolve(__dirname, '../dist'), { index: false, fallthrough: true }));
app.get('*path', (_req, res) => res.sendFile(path.resolve(__dirname, '../dist/index.html')));
app.use((error, _req, res, _next) => {
  console.error('Bella server request failed', error.message);
  res.status(error.status || 400).json({ success: false, message: 'Invalid request' });
});

const cleanup = async () => {
  try {
    const expired = await pool.query("SELECT id FROM orders WHERE order_status='PENDING_PAYMENT' AND stock_reserved=true AND reservation_expires_at<=now() AND NOT EXISTS (SELECT 1 FROM payments WHERE payments.order_id=orders.id) FOR UPDATE SKIP LOCKED");
    for (const { id } of expired.rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query("SELECT id FROM orders WHERE id=$1 AND order_status='PENDING_PAYMENT' AND stock_reserved=true AND reservation_expires_at<=now() AND NOT EXISTS (SELECT 1 FROM payments WHERE payments.order_id=orders.id) FOR UPDATE", [id]);
        if (locked.rowCount) {
          const items = await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1', [id]);
          for (const item of items.rows) await client.query('UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=now() WHERE id=$2', [item.quantity, item.product_id]);
          await client.query("UPDATE orders SET order_status='CANCELLED',stock_reserved=false,reservation_expires_at=NULL,updated_at=now() WHERE id=$1", [id]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
  } catch (error) { console.error('Reservation cleanup failed', error.message); }
};

const timer = setInterval(cleanup, ttl);
timer.unref();
const server = app.listen(port, () => console.log(`Bella API listening on ${port}`));
async function shutdown() { clearInterval(timer); server.close(); await pool.end(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
