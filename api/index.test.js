const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://bella_test:bella_test@127.0.0.1:1/bella_test';
process.env.SESSION_SECRET ||= 'test-session-secret-not-for-production';
const handler = require('./index');
const { route } = handler._test;

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end(value) { this.body = value; return this; },
  };
}

test('health route is independent of database setup', async () => {
  const res = response();
  await route({ method: 'GET', query: {} }, res, 'health', ['health']);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { service: 'bella-api' });
});

test('invalid checkout is rejected before opening a database connection', async () => {
  const res = response();
  await route({ method: 'POST', body: { customer_name: '', quantity: 0 }, query: {} }, res, 'orders', ['orders']);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.message, /customer/);
});

test('invalid order status input returns a validation response', async () => {
  const res = response();
  await route({ method: 'POST', body: { order_number: 'bad', phone: '' }, query: {} }, res, 'orders/status', ['orders', 'status']);
  assert.equal(res.statusCode, 422);
});

test('public checkout config requires a valid configured delivery fee', async () => {
  const previous = process.env.BELLA_DELIVERY_FEE_EGP;
  delete process.env.BELLA_DELIVERY_FEE_EGP;
  const missing = response();
  await route({ method: 'GET', query: {} }, missing, 'checkout/config', ['checkout', 'config']);
  assert.equal(missing.statusCode, 503);
  process.env.BELLA_DELIVERY_FEE_EGP = '75.5';
  const configured = response();
  await route({ method: 'GET', query: {} }, configured, 'checkout/config', ['checkout', 'config']);
  assert.equal(configured.statusCode, 200);
  assert.equal(configured.body.data.delivery_fee, '75.50');
  process.env.BELLA_DELIVERY_FEE_EGP = '1.234';
  assert.throws(() => handler._test.getDeliveryFee(), { status: 503 });
  if (previous === undefined) delete process.env.BELLA_DELIVERY_FEE_EGP; else process.env.BELLA_DELIVERY_FEE_EGP = previous;
});

test('checkout accepts PostgreSQL bigint product ids returned as strings', () => {
  assert.equal(handler._test.parseProductId('42'), 42);
  assert.equal(handler._test.parseProductId(42), 42);
  assert.equal(handler._test.parseProductId('1.5'), null);
  assert.equal(handler._test.parseProductId('-1'), null);
  assert.equal(handler._test.parseProductId('9007199254740992'), null);
});

test('stock reservation stores a price snapshot and rejects overselling', async () => {
  const calls = [];
  const client = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id,name,price')) return { rowCount: 1, rows: [{ id: '9', name: 'Linen pouch', price: '12.50', stock_quantity: 3 }] };
    if (sql.startsWith('INSERT INTO orders')) return { rows: [{ id: '21' }] };
    return { rows: [], rowCount: 1 };
  } };
  const body = { customer_name: 'A Customer', phone: '01012345678', address: 'Cairo', quantity: 2 };
  const order = await handler._test.reserveOrder(client, body, 9, 75.5);
  assert.equal(order.total_amount, '100.50');
  assert.equal(order.delivery_fee, '75.50');
  assert.match(order.order_number, /^BELLA-[A-F0-9]{8}$/);
  assert.deepEqual(calls.find(call => call.sql.startsWith('UPDATE products')).params, [2, '9']);
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO orders')).params.slice(-2), ['100.50', '75.50']);
  assert.match(calls.find(call => call.sql.startsWith('INSERT INTO orders')).sql, /now\(\)\+interval '30 minutes'/);
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO order_items')).params.slice(2), ['Linen pouch', '12.50', 2, '25.00']);
  client.query = async sql => sql.startsWith('SELECT id,name,price') ? { rowCount: 1, rows: [{ id: 9, name: 'Linen pouch', price: '12.50', stock_quantity: 1 }] } : { rows: [] };
  await assert.rejects(handler._test.reserveOrder(client, body, 9), { status: 409 });
  client.query = async () => ({ rowCount: 0, rows: [] });
  await assert.rejects(handler._test.reserveOrder(client, body, 404), { status: 404 });
});

test('unknown routes return JSON 404', async () => {
  const res = response();
  await route({ method: 'GET', query: {} }, res, 'missing', ['missing']);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /not found/);
});

test('reservation cleanup route requires the Vercel cron secret', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const res = response();
  await route({ method: 'GET', headers: {}, query: {} }, res, 'cron/expire-reservations', ['cron', 'expire-reservations']);
  if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  assert.equal(res.statusCode, 401);
});

test('admin reads and writes require signed sessions and CSRF tokens', async () => {
  const unauthenticated = response();
  await route({ method: 'GET', headers: {}, query: {} }, unauthenticated, 'admin/payments', ['admin', 'payments']);
  assert.equal(unauthenticated.statusCode, 401);

  const admin = { id: 7, username: 'staff', csrf: 'secure-csrf-token', exp: Date.now() + 60000 };
  const token = handler._test.signSession(admin);
  const denied = response();
  await route({ method: 'POST', headers: { cookie: `bella_session=${token}` }, body: {}, query: {} }, denied, 'admin/logout', ['admin', 'logout']);
  assert.equal(denied.statusCode, 403);

  const allowed = response();
  await route({ method: 'POST', headers: { cookie: `bella_session=${token}`, 'x-csrf-token': admin.csrf }, body: {}, query: {} }, allowed, 'admin/logout', ['admin', 'logout']);
  assert.equal(allowed.statusCode, 200);
  assert.match(allowed.headers['Set-Cookie'], /Max-Age=0/);
});

test('payment approval moves to processing and rejection releases stock and closes the order', async () => {
  const calls = [];
  const client = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT product_id')) return { rows: [{ product_id: 12, quantity: 2 }] };
    return { rows: [], rowCount: 1 };
  } };
  const payment = { payment_status: 'PENDING', order_status: 'PENDING_PAYMENT', stock_reserved: true, order_id: 4, admin_note: null };
  const approved = await handler._test.applyPaymentDecision(client, payment, 'approve', 5);
  assert.equal(approved.order_status, 'PROCESSING');
  assert.match(calls.at(-1).sql, /order_status='PROCESSING'/);
  calls.length = 0;
  const rejected = await handler._test.applyPaymentDecision(client, payment, 'reject', 5);
  assert.equal(rejected.order_status, 'CANCELLED');
  assert.ok(calls.some(call => call.sql.startsWith('UPDATE products SET stock_quantity=stock_quantity+')));
  assert.match(calls.at(-1).sql, /order_status='CANCELLED'/);
  await assert.rejects(handler._test.applyPaymentDecision(client, payment, 'nope', 5), { status: 400 });
  await assert.rejects(handler._test.applyPaymentDecision(client, { ...payment, stock_reserved: false }, 'approve', 5), { status: 409 });
});

test('signed session rejects altered, expired, and malformed cookies', () => {
  const valid = handler._test.signSession({ id: 1, username: 'a', csrf: 'b', exp: Date.now() + 60000 });
  assert.ok(handler._test.readSession({ headers: { cookie: `bella_session=${valid}` } }));
  assert.equal(handler._test.readSession({ headers: { cookie: `bella_session=${valid}x` } }), null);
  const expired = handler._test.signSession({ id: 1, username: 'a', csrf: 'b', exp: Date.now() - 1 });
  assert.equal(handler._test.readSession({ headers: { cookie: `bella_session=${expired}` } }), null);
  assert.equal(handler._test.readSession({ headers: { cookie: 'bella_session=bad.value' } }), null);
});

test('receipt and product uploads are checked by content signature', () => {
  assert.deepEqual(handler.identify(Buffer.from('%PDF-1.7'), 'receipt'), ['pdf', 'application/pdf']);
  assert.deepEqual(handler.identify(Buffer.from([255, 216, 255, 1]), 'receipt'), ['jpg', 'image/jpeg']);
  assert.deepEqual(handler.identify(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image'), ['png', 'image/png']);
  assert.deepEqual(handler.identify(Buffer.from('RIFF0000WEBP'), 'image'), ['webp', 'image/webp']);
  assert.throws(() => handler.identify(Buffer.from('spoofed'), 'receipt'), { status: 415 });
  assert.throws(() => handler.identify(Buffer.from('spoofed'), 'image'), { status: 415 });
});

test('product image URLs retain the private bucket object path', async () => {
  const fs = require('node:fs/promises');
  const source = await fs.readFile(require.resolve('../frontend/index.jsx'), 'utf8');
  assert.match(source, /split\('\/'\)\.map\(encodeURIComponent\)/);
  assert.match(source, /src=\{heroImage\}/);
});

test('storefront has no public admin navigation and the preview checkout is clearly simulated', async () => {
  const fs = require('node:fs/promises');
  const source = await fs.readFile(require.resolve('../frontend/index.jsx'), 'utf8');
  assert.doesNotMatch(source, /href="\/admin\.html"/);
  assert.match(source, /const preview = import\.meta\.env\.DEV/);
  assert.match(source, /no money or orders are created/);
  assert.match(source, /api\('orders'/);
  assert.match(source, /api\('payments'/);
});

test('production storefront requires a configured public payment destination', async () => {
  const fs = require('node:fs/promises');
  const source = await fs.readFile(require.resolve('../frontend/index.jsx'), 'utf8');
  assert.match(source, /VITE_INSTAPAY_HANDLE/);
  assert.match(source, /VITE_ORANGE_CASH_NUMBER/);
  assert.match(source, /!paymentReady/);
  assert.match(source, /form\.set\('payment_method', paymentMethod\)/);
  assert.match(source, /api\('checkout\/config'/);
  assert.match(source, /payment-breakdown/);
  assert.match(source, /required=\{available\}/);
});
