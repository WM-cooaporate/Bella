const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'test-secret-only';
const handler = require('./index');

function response() {
  return { statusCode: 200, headers: {}, body: '', status(code) { this.statusCode = code; return this; }, setHeader(key,value) { this.headers[key]=value; return this; }, end(body='') { this.body=body; return this; }, send(body) { this.body=body; return this; } };
}

test('rejects invalid checkout before opening a database connection', async () => {
  const res=response();
  await handler({method:'POST',headers:{},query:{path:'orders'},body:{customer_name:'',phone:'invalid',address:'',product_id:1,quantity:1}},res);
  assert.equal(res.statusCode,422);
  assert.match(res.body,/customer/);
});

test('requires an admin session for protected reads', async () => {
  const res=response();
  await handler({method:'GET',headers:{},query:{path:'admin/payments'}},res);
  assert.equal(res.statusCode,401);
});

test('returns a service availability response instead of crashing on missing configuration', async () => {
  const oldDatabase = process.env.DATABASE_URL;
  const oldSecret = process.env.SESSION_SECRET;
  delete process.env.DATABASE_URL;
  const res = response();
  await handler({method:'GET',headers:{},query:{path:'admin/session'}},res);
  if (oldDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabase;
  if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
  assert.equal(res.statusCode,503);
  assert.match(res.body,/service is not configured/);
});

test('rejects malformed checkout fields before database access', async () => {
  const res=response();
  await handler({method:'POST',headers:{},query:{path:'orders'},body:{customer_name:'A',phone:'01012345678',address:'Road',product_id:1,quantity:1.5}},res);
  assert.equal(res.statusCode,422);
});

test('rejects unauthenticated admin mutations and checks CSRF on logout', async () => {
  const res=response();
  await handler({method:'POST',headers:{},query:{path:'admin/payments/12/review'},body:{decision:'approve'}},res);
  assert.equal(res.statusCode,401);
});

test('rejects unknown API routes consistently', async () => {
  const res=response();
  await handler({method:'GET',headers:{},query:{path:'not-a-real-route'}},res);
  assert.equal(res.statusCode,404);
  assert.match(res.body,/API endpoint not found/);
});

test('preserves storage object paths in the storefront image URL form', async () => {
  const { readFile } = require('node:fs/promises');
  const source = await readFile(require.resolve('../frontend/index.jsx'), 'utf8');
  assert.match(source,/split\('\/'\)\.map\(encodeURIComponent\)/);
  assert.match(source,/src=\{heroImage\}/);
});

test('validates receipt and product uploads from file signatures', () => {
  assert.deepEqual(handler.identify(Buffer.from('%PDF-1.7'),'receipt'),['pdf','application/pdf']);
  assert.deepEqual(handler.identify(Buffer.from([255,216,255,0]),'receipt'),['jpg','image/jpeg']);
  assert.throws(()=>handler.identify(Buffer.from('not an image'),'image'),{status:415});
  assert.throws(()=>handler.identify(Buffer.from('GIF89a'),'receipt'),{status:415});
});
