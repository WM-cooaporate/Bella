const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const { createClient } = require('@supabase/supabase-js');
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true },
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
const storage = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage
  : null;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'bella-private';
const sessionSecret = process.env.SESSION_SECRET;
const ok = data => ({ success: true, data });
const fail = message => ({ success: false, message });

function send(res, status, body, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.status(status).json(body);
}

function signSession(value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(req) {
  if (!sessionSecret) return null;
  const token = cookie.parse(req.headers.cookie || '').bella_session;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', sessionSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return value.exp > Date.now() ? value : null;
  } catch { return null; }
}

function requireAdmin(req, res) {
  const admin = readSession(req);
  if (!admin) send(res, 401, fail('Authentication required'));
  return admin;
}

function requireCsrf(req, res, admin) {
  if (!admin || req.headers['x-csrf-token'] !== admin.csrf) {
    send(res, 403, fail('CSRF validation failed'));
    return false;
  }
  return true;
}

function identify(buffer, kind) {
  if (kind === 'receipt') {
    if (buffer.subarray(0, 5).toString() === '%PDF-') return ['pdf', 'application/pdf'];
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return ['jpg', 'image/jpeg'];
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['png', 'image/png'];
  } else {
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return ['jpg', 'image/jpeg'];
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['png', 'image/png'];
    if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return ['webp', 'image/webp'];
  }
  throw Object.assign(new Error('Unsupported or invalid file content'), { status: 415 });
}

function parseProductId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function reserveOrder(client, body, productId) {
  const found = await client.query('SELECT id,name,price,stock_quantity FROM products WHERE id=$1 AND is_active=true FOR UPDATE', [productId]);
  if (!found.rowCount) throw Object.assign(new Error('Product not found'), { status: 404 });
  const product = found.rows[0];
  if (product.stock_quantity < body.quantity) throw Object.assign(new Error('Insufficient stock'), { status: 409 });
  const total = (Number(product.price) * body.quantity).toFixed(2);
  const orderNumber = `BELLA-${randomBytes(4).toString('hex').toUpperCase()}`;
  await client.query('UPDATE products SET stock_quantity=stock_quantity-$1,updated_at=now() WHERE id=$2', [body.quantity, product.id]);
  const inserted = await client.query("INSERT INTO orders(order_number,customer_name,phone,address,total_amount,order_status,reservation_expires_at,stock_reserved) VALUES($1,$2,$3,$4,$5,'PENDING_PAYMENT',now()+interval '30 minutes',true) RETURNING id", [orderNumber, body.customer_name.trim(), body.phone, body.address.trim(), total]);
  await client.query('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [inserted.rows[0].id, product.id, product.name, product.price, body.quantity, total]);
  return { order_id: inserted.rows[0].id, order_number: orderNumber, total_amount: total };
}

function readMultipart(req, limit) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);
    if (!boundary) return reject(Object.assign(new Error('Invalid multipart request'), { status: 400 }));
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('Upload exceeds allowed size'), { status: 413 })); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const fields = {}, files = {};
        const raw = Buffer.concat(chunks).toString('latin1');
        for (const part of raw.split(`--${boundary}`).slice(1, -1)) {
          const splitAt = part.indexOf('\r\n\r\n');
          if (splitAt < 0) continue;
          const headers = part.slice(0, splitAt);
          const body = part.slice(splitAt + 4).replace(/\r\n$/, '');
          const name = headers.match(/name="([^"]+)"/)?.[1];
          if (!name) continue;
          const filename = headers.match(/filename="([^"]*)"/)?.[1];
          if (filename !== undefined) {
            files[name] = { name: filename, mime: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream', data: Buffer.from(body, 'latin1') };
          } else fields[name] = body;
        }
        resolve({ fields, files });
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

async function putPrivateFile(file, folder, type) {
  if (!storage) throw Object.assign(new Error('Private file storage is not configured'), { status: 503 });
  const [extension, mime] = identify(file.data, type);
  const path = `${folder}/${randomBytes(20).toString('hex')}.${extension}`;
  const { error } = await storage.from(bucket).upload(path, file.data, { contentType: mime, upsert: false });
  if (error) throw Object.assign(new Error('Unable to save uploaded file'), { status: 502 });
  return path;
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function cleanupExpiredReservations() {
  return transaction(async client => {
    const expired = await client.query("SELECT id FROM orders WHERE order_status='PENDING_PAYMENT' AND stock_reserved=true AND reservation_expires_at<=now() AND NOT EXISTS (SELECT 1 FROM payments WHERE payments.order_id=orders.id) FOR UPDATE SKIP LOCKED");
    for (const { id } of expired.rows) {
      const items = await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1', [id]);
      for (const item of items.rows) await client.query('UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=now() WHERE id=$2', [item.quantity, item.product_id]);
      await client.query("UPDATE orders SET order_status='CANCELLED',stock_reserved=false,reservation_expires_at=NULL,updated_at=now() WHERE id=$1", [id]);
    }
    return expired.rowCount;
  });
}

async function applyPaymentDecision(client, payment, decision, paymentId) {
  if (!['approve', 'reject'].includes(decision)) throw Object.assign(new Error('Invalid decision'), { status: 400 });
  if (payment.payment_status !== 'PENDING' || payment.order_status !== 'PENDING_PAYMENT' || !payment.stock_reserved) throw Object.assign(new Error('Payment or order cannot be reviewed'), { status: 409 });
  const approved = decision === 'approve';
  await client.query('UPDATE payments SET payment_status=$1,admin_note=$2,reviewed_at=now(),updated_at=now() WHERE id=$3', [approved ? 'PAID' : 'REJECTED', payment.admin_note || null, paymentId]);
  if (approved) {
    await client.query("UPDATE orders SET order_status='PROCESSING',stock_reserved=false,reservation_expires_at=NULL,updated_at=now() WHERE id=$1", [payment.order_id]);
  } else {
    const items = await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1', [payment.order_id]);
    for (const item of items.rows) await client.query('UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=now() WHERE id=$2', [item.quantity, item.product_id]);
    await client.query("UPDATE orders SET order_status='CANCELLED',stock_reserved=false,reservation_expires_at=NULL,updated_at=now() WHERE id=$1", [payment.order_id]);
  }
  return { payment_id: Number(paymentId), payment_status: approved ? 'PAID' : 'REJECTED', order_status: approved ? 'PROCESSING' : 'CANCELLED' };
}

async function route(req, res, action, parts) {
  const method = req.method;
  if (action === 'health' && method === 'GET') return send(res, 200, ok({ service: 'bella-api' }));
  if (!process.env.DATABASE_URL) return send(res, 503, fail('Database service is not configured'));
  if (action === 'cron/expire-reservations' && method === 'GET') {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, fail('Authentication required'));
    const released = await cleanupExpiredReservations();
    return send(res, 200, ok({ expired_orders: released }));
  }

  if (action === 'products' && method === 'GET') {
    const { rows } = await pool.query('SELECT id,name,description,price,image,stock_quantity FROM products WHERE is_active=true ORDER BY created_at DESC,id DESC');
    return send(res, 200, ok(rows));
  }
  if (action.startsWith('product-images/') && method === 'GET') {
    const path = decodeURIComponent(action);
    if (!/^product-images\/[a-f0-9]{40}\.(jpg|png|webp)$/.test(path)) return send(res, 404, fail('Image not found'));
    if (!storage) return send(res, 503, fail('Private file storage is not configured'));
    const { data, error } = await storage.from(bucket).download(path);
    if (error) return send(res, 404, fail('Image not found'));
    const image = Buffer.from(await data.arrayBuffer());
    const mime = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
    return res.status(200).send(image);
  }
  if (action === 'orders' && method === 'POST') {
    const body = req.body || {};
    const productId = parseProductId(body.product_id);
    if (typeof body.customer_name !== 'string' || !body.customer_name.trim() || body.customer_name.length > 150 || !/^01[0125][0-9]{8}$/.test(body.phone || '') || typeof body.address !== 'string' || !body.address.trim() || body.address.length > 2000 || productId === null || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 100) return send(res, 422, fail('Check customer, phone, address, product, and quantity'));
    await cleanupExpiredReservations();
    const order = await transaction(client => reserveOrder(client, body, productId));
    return send(res, 201, ok(order));
  }
  if (action === 'orders/status' && method === 'POST') {
    const body = req.body || {};
    if (!/^BELLA-[A-F0-9]{8}$/i.test(body.order_number || '') || !/^01[0125][0-9]{8}$/.test(body.phone || '')) return send(res, 422, fail('Enter a valid order number and Egyptian mobile number'));
    const { rows } = await pool.query('SELECT order_number,total_amount,order_status,created_at FROM orders WHERE order_number=$1 AND phone=$2', [body.order_number.toUpperCase(), body.phone]);
    return rows[0] ? send(res, 200, ok(rows[0])) : send(res, 404, fail('We could not find an order matching those details'));
  }
  if (action === 'payments' && method === 'POST') {
    const { fields, files } = await readMultipart(req, 4 * 1024 * 1024);
    const file = files.receipt;
    const orderId = Number(fields.order_id);
    if (!file || !file.data.length || file.data.length > 3 * 1024 * 1024 || !Number.isInteger(orderId) || orderId < 1 || !['INSTAPAY', 'ORANGE_CASH'].includes(fields.payment_method) || (fields.transaction_reference || '').length > 150) return send(res, 422, fail('Select a payment method and attach a valid receipt up to 3 MB'));
    identify(file.data, 'receipt');
    const result = await transaction(async client => {
      const found = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!found.rowCount) throw Object.assign(new Error('Order not found'), { status: 404 });
      const order = found.rows[0];
      if (order.order_status !== 'PENDING_PAYMENT' || !order.stock_reserved || !order.reservation_expires_at || new Date(order.reservation_expires_at) < new Date()) throw Object.assign(new Error('Order reservation is no longer valid'), { status: 409 });
      const existing = await client.query("SELECT id FROM payments WHERE order_id=$1 AND payment_status IN ('PENDING','PAID')", [orderId]);
      if (existing.rowCount) throw Object.assign(new Error('A pending or completed payment already exists for this order'), { status: 409 });
      const path = await putPrivateFile(file, 'receipts', 'receipt');
      const payment = await client.query('INSERT INTO payments(order_id,payment_method,amount,transaction_reference,receipt_path) VALUES($1,$2,$3,$4,$5) RETURNING id', [orderId, fields.payment_method, order.total_amount, fields.transaction_reference || null, path]);
      await client.query('UPDATE orders SET reservation_expires_at=NULL WHERE id=$1', [orderId]);
      return { payment_id: payment.rows[0].id, order_id: orderId, amount: order.total_amount, payment_status: 'PENDING' };
    });
    return send(res, 201, ok(result));
  }

  if (!action.startsWith('admin/')) return send(res, 404, fail('API endpoint not found'));
  if (!sessionSecret) return send(res, 503, fail('Admin service is not configured'));
  if (action === 'admin/login' && method === 'POST') {
    const body = req.body || {};
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 100 || body.password.length > 200) return send(res, 422, fail('Invalid username or password'));
    const found = await pool.query('SELECT id,username,password_hash FROM admins WHERE username=$1', [body.username]);
    if (!found.rowCount || !await bcrypt.compare(body.password, found.rows[0].password_hash)) return send(res, 401, fail('Invalid username or password'));
    const admin = { id: found.rows[0].id, username: found.rows[0].username, csrf: randomBytes(32).toString('hex'), exp: Date.now() + 8 * 60 * 60 * 1000 };
    res.setHeader('Set-Cookie', cookie.serialize('bella_session', signSession(admin), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 }));
    return send(res, 200, ok({ admin_id: admin.id, username: admin.username, csrf_token: admin.csrf }));
  }
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (action === 'admin/session' && method === 'GET') return send(res, 200, ok({ admin_id: admin.id, username: admin.username, csrf_token: admin.csrf }));
  if (action === 'admin/logout' && method === 'POST') {
    if (!requireCsrf(req, res, admin)) return;
    res.setHeader('Set-Cookie', cookie.serialize('bella_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 }));
    return send(res, 200, ok({}));
  }
  if (action === 'admin/payments' && method === 'GET') {
    const { rows } = await pool.query("SELECT p.id AS payment_id,p.order_id,p.payment_method,p.amount,p.transaction_reference,p.payment_status,p.created_at AS payment_created_at,(p.receipt_path IS NOT NULL) AS receipt_available,o.order_number,o.customer_name,o.phone,o.address,o.total_amount,o.order_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.payment_status='PENDING' ORDER BY p.created_at,p.id");
    return send(res, 200, ok(rows));
  }
  if (action === 'admin/orders' && method === 'GET') {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = await pool.query("SELECT o.*,string_agg(oi.product_name||' x'||oi.quantity,', ' ORDER BY oi.id) items_summary,EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id) has_payment FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC,o.id DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const count = Number((await pool.query('SELECT count(*) FROM orders')).rows[0].count);
    return send(res, 200, ok({ orders: result.rows, pagination: { limit, offset, total: count, has_more: offset + result.rowCount < count } }));
  }
  if (action === 'admin/products' && method === 'POST') {
    if (!requireCsrf(req, res, admin)) return;
    const { fields, files } = await readMultipart(req, 4.4 * 1024 * 1024);
    const image = files.image, price = Number(fields.price), stock = Number(fields.stock_quantity || 0);
    if (!fields.name?.trim() || fields.name.length > 150 || (fields.description || '').length > 5000 || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0 || !image || image.data.length > 4 * 1024 * 1024) return send(res, 422, fail('Check product details and attach an image up to 4 MB'));
    identify(image.data, 'image');
    const path = await putPrivateFile(image, 'product-images', 'image');
    const result = await pool.query('INSERT INTO products(name,description,price,image,stock_quantity) VALUES($1,$2,$3,$4,$5) RETURNING id', [fields.name.trim(), fields.description || '', price, path, stock]);
    return send(res, 201, ok({ id: result.rows[0].id }));
  }
  if (parts.length === 4 && parts[1] === 'payments' && /^\d+$/.test(parts[2]) && parts[3] === 'receipt' && method === 'GET') {
    const found = await pool.query('SELECT receipt_path FROM payments WHERE id=$1', [parts[2]]);
    if (!found.rowCount || !found.rows[0].receipt_path || !storage) return send(res, 404, fail('Receipt not found'));
    const { data, error } = await storage.from(bucket).download(found.rows[0].receipt_path);
    if (error) return send(res, 404, fail('Receipt not found'));
    const path = found.rows[0].receipt_path;
    const mime = path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime); res.setHeader('Cache-Control', 'private,no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(Buffer.from(await data.arrayBuffer()));
  }
  if (parts.length === 4 && parts[1] === 'payments' && /^\d+$/.test(parts[2]) && parts[3] === 'review' && method === 'POST') {
    if (!requireCsrf(req, res, admin)) return;
    const decision = req.body?.decision;
    const result = await transaction(async client => {
      const found = await client.query('SELECT p.*,o.order_status,o.stock_reserved FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF p,o', [parts[2]]);
      if (!found.rowCount) throw Object.assign(new Error('Payment not found'), { status: 404 });
      return applyPaymentDecision(client, { ...found.rows[0], admin_note: (req.body.admin_note || '').slice(0, 2000) || null }, decision, parts[2]);
    });
    return send(res, 200, ok(result));
  }
  if (parts.length === 4 && parts[1] === 'orders' && /^\d+$/.test(parts[2]) && parts[3] === 'cancel' && method === 'POST') {
    if (!requireCsrf(req, res, admin)) return;
    const result = await transaction(async client => {
      const found = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [parts[2]]);
      if (!found.rowCount) throw Object.assign(new Error('Order not found'), { status: 404 });
      const order = found.rows[0];
      if (order.order_status !== 'PENDING_PAYMENT' || !order.stock_reserved) throw Object.assign(new Error('Order cannot be cancelled'), { status: 409 });
      if ((await client.query('SELECT id FROM payments WHERE order_id=$1', [parts[2]])).rowCount) throw Object.assign(new Error('Order with payment record requires payment review'), { status: 409 });
      const items = await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1', [parts[2]]);
      for (const item of items.rows) await client.query('UPDATE products SET stock_quantity=stock_quantity+$1,updated_at=now() WHERE id=$2', [item.quantity, item.product_id]);
      await client.query("UPDATE orders SET order_status='CANCELLED',stock_reserved=false,reservation_expires_at=NULL,updated_at=now() WHERE id=$1", [parts[2]]);
      return { order_id: Number(parts[2]), order_status: 'CANCELLED' };
    });
    return send(res, 200, ok(result));
  }
  return send(res, 404, fail('API endpoint not found'));
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.BELLA_CORS_ORIGIN;
  if (allowedOrigin && req.headers.origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const parts = String(req._bellaPath || req.query?.path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  try {
    return await route(req, res, parts.join('/'), parts);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('Bella API failure', { status, message: error.message });
    return send(res, status, fail(status === 500 ? 'Internal server error' : error.message));
  }
};

module.exports.identify = identify;
module.exports.cleanupExpiredReservations = cleanupExpiredReservations;
module.exports._test = { route, signSession, readSession, applyPaymentDecision, parseProductId, reserveOrder };
