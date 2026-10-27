// Delivery charges, SSLCommerz online payment (against a fake SSLCommerz) and SEO tags.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { createMailer } from '../server/mail.mjs';
import { createGateway } from '../server/sslcommerz.mjs';
import { hashPassword } from '../server/auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { error() {}, log() {} };
let dir; let db; let server; let base; let ssl; let sslBase;

// A fake SSLCommerz: records each payment session and answers validation from `validations`.
const gw = { sessions: [], validations: new Map(), failNext: false };
function fakeSslcommerz() {
  return http.createServer((req, res) => {
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/gwprocess/v4/api.php') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const f = Object.fromEntries(new URLSearchParams(body));
        if (f.store_id !== 'test-store' || f.store_passwd !== 'test-pass') return json({ status: 'FAILED', failedreason: 'Store Credential Error' });
        if (gw.failNext) { gw.failNext = false; return json({ status: 'FAILED', failedreason: 'Gateway busy' }); }
        gw.sessions.push(f);
        return json({ status: 'SUCCESS', GatewayPageURL: `https://sandbox.sslcommerz.test/pay/${f.tran_id}`, sessionkey: 'k' });
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/validator/api/validationserverAPI.php') {
      const v = gw.validations.get(url.searchParams.get('val_id'));
      return json(v && url.searchParams.get('store_passwd') === 'test-pass' ? v : { status: 'INVALID_TRANSACTION' });
    }
    res.writeHead(404); res.end();
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'decoture-pay-'));
  db = openDb(join(dir, 'test.db'), { seedCsv: join(root, 'data', 'stock.csv') });
  db.addAdmin('admin', hashPassword('correct horse battery'));
  ssl = fakeSslcommerz();
  await new Promise((r) => ssl.listen(0, '127.0.0.1', r));
  sslBase = `http://127.0.0.1:${ssl.address().port}`;
  const gateway = createGateway({ storeId: 'test-store', storePassword: 'test-pass', baseUrl: sslBase });
  const app = createApp({ db, root, uploadsDir: join(dir, 'uploads'), mailer: createMailer({}), gateway, config: { orderLimit: 1000, siteUrl: 'https://decoture.example' }, log: quiet });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); ssl.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (path, { method = 'GET', body, cookie, headers = {}, form } = {}) => {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
};
const order = (over = {}) => ({
  name: 'Nusrat Jahan', phone: '01912345678', email: 'nusrat@example.com', district: 'Dhaka', area: 'Banani', address: 'Road 11, House 4',
  payment: 'Cash on delivery', items: [{ id: 'c-2301-full-black', qty: 1 }], ...over,
});
const stockOf = async (id) => {
  const { data } = await call('/api/catalog');
  for (const p of data.products) for (const v of p.variants) if (v.id === id) return v.stock;
  return undefined;
};
async function login() {
  const r = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'correct horse battery' } });
  return r.headers.get('set-cookie').split(';')[0];
}
// What SSLCommerz's validation API says about a payment.
const valid = (session, over = {}) => ({ status: 'VALID', tran_id: session.tran_id, val_id: `VAL-${session.tran_id}`, amount: session.total_amount, currency_type: 'BDT', currency_amount: session.total_amount, card_issuer: 'bKash', bank_tran_id: 'BK123', risk_level: '0', ...over });

test('charges delivery by district and number of chairs', async () => {
  const cases = [
    [{ district: 'Dhaka', items: [{ id: 'c-2301-full-black', qty: 2 }] }, 400, 'dhaka'],
    [{ district: 'Gazipur' }, 500, 'near'],
    [{ district: 'Rangpur', items: [{ id: 'c-2301-full-black', qty: 3 }] }, 1200, 'outside'],
  ];
  for (const [over, fee, zone] of cases) {
    const r = await call('/api/orders', { method: 'POST', body: order(over) });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.order.deliveryFee, fee, over.district);
    assert.equal(r.data.order.total, r.data.order.subtotal + fee);
    assert.equal(db.order(r.data.order.id).zone, zone);
  }
  const js = await call('/assets/js/catalog.js');
  assert.match(js.data, /"delivery":/);
  assert.match(js.data, /"online": true/);
  assert.match(js.data, /"Thakurgaon"/);
});

test('admin changes delivery charges, and checks them', async () => {
  const cookie = await login();
  const { data } = await call('/api/admin/settings', { cookie });
  assert.equal(data.payments.online, true);
  assert.equal(data.payments.mode, 'sandbox');
  const next = structuredClone(data.delivery);
  next.zones[0].fee = 250;
  next.zones[1].districts.push('Tangail');
  next.freeOver = 50000;
  const bad = structuredClone(next);
  bad.zones[1].districts.push('Dhaka');
  assert.equal((await call('/api/admin/settings/delivery', { method: 'PUT', cookie, body: bad })).status, 400, 'a district in two zones');
  const typo = structuredClone(next);
  typo.zones[0].districts.push('Dhakka');
  assert.match((await call('/api/admin/settings/delivery', { method: 'PUT', cookie, body: typo })).data.error, /not a district/);
  assert.equal((await call('/api/admin/settings/delivery', { method: 'PUT', cookie, body: { ...next, zones: [{ ...next.zones[0], fee: -5 }, next.zones[1], next.zones[2]] } })).status, 400);
  assert.equal((await call('/api/admin/settings/delivery', { method: 'PUT', body: next })).status, 401);
  assert.equal((await call('/api/admin/settings/delivery', { method: 'PUT', cookie, body: next })).status, 200);

  const tangail = await call('/api/orders', { method: 'POST', body: order({ district: 'Tangail' }) });
  assert.equal(tangail.data.order.deliveryFee, 500, 'Tangail moved to the near zone');
  const big = await call('/api/orders', { method: 'POST', body: order({ items: [{ id: 'c-2301-full-black', qty: 6 }] }) });
  assert.equal(big.data.order.deliveryFee, 0, 'free over the threshold');
  assert.match(big.data.order.delivery, /free delivery/);
  // Put the defaults back for the other tests.
  next.zones[0].fee = 300; next.zones[1].districts.pop(); next.freeOver = null;
  await call('/api/admin/settings/delivery', { method: 'PUT', cookie, body: next });
});

test('online payment: SSLCommerz confirms it, then the order is paid once', async () => {
  const r = await call('/api/orders', { method: 'POST', body: order({ payment: 'Online payment', items: [{ id: 'c-2301-full-black', qty: 2 }] }) });
  assert.equal(r.status, 201);
  const o = r.data.order;
  assert.equal(o.paymentStatus, 'pending');
  const session = gw.sessions.at(-1);
  assert.equal(r.data.payUrl, `https://sandbox.sslcommerz.test/pay/${session.tran_id}`);
  assert.equal(session.total_amount, (o.total).toFixed(2), 'the server sends its own total');
  assert.equal(session.currency, 'BDT');
  assert.ok(session.tran_id.startsWith(`${o.id}-`));
  assert.equal(session.success_url, 'https://decoture.example/api/pay/sslcommerz/success');
  assert.equal(session.cus_phone, '01912345678');

  // A forged success without a real val_id does nothing.
  const forged = await call('/api/pay/sslcommerz/success', { method: 'POST', form: { tran_id: session.tran_id, val_id: 'made-up', status: 'VALID' }, headers: { origin: 'https://sandbox.sslcommerz.com' } });
  assert.equal(forged.status, 303);
  assert.match(forged.headers.get('location'), /payment=failed/);
  assert.equal(db.order(o.id).paymentStatus, 'failed');

  // The real one: the browser comes back from SSLCommerz (a cross-site form post).
  const v = valid(session);
  gw.validations.set(v.val_id, v);
  const back = await call('/api/pay/sslcommerz/success', { method: 'POST', form: { tran_id: session.tran_id, val_id: v.val_id, status: 'VALID' }, headers: { origin: 'https://sandbox.sslcommerz.com' } });
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), `/order.html?id=${o.id}&payment=paid`);
  const paid = db.order(o.id);
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal(paid.paidAmount, o.total);
  assert.match(paid.paymentRef, /BK123/);
  const events = paid.events.length;

  // The IPN arrives too: nothing changes twice.
  const ipn = await call('/api/pay/sslcommerz/ipn', { method: 'POST', form: { tran_id: session.tran_id, val_id: v.val_id, status: 'VALID' } });
  assert.equal(ipn.status, 200);
  assert.equal(db.order(o.id).events.length, events);
  const track = await call(`/api/orders/${o.id}?phone=01912345678`);
  assert.equal(track.data.order.paymentStatus, 'paid');
  assert.equal((await call(`/api/orders/${o.id}/pay`, { method: 'POST', body: { phone: '01912345678' } })).status, 409, 'a paid order cannot be paid again');
});

test('online payment: a wrong amount is refused; the customer retries or switches to cash', async () => {
  const before = await stockOf('c-2301-full-black');
  const r = await call('/api/orders', { method: 'POST', body: order({ payment: 'Online payment' }) });
  const o = r.data.order;
  assert.equal(await stockOf('c-2301-full-black'), before - 1, 'chairs are held while the customer pays');
  const session = gw.sessions.at(-1);
  const cheap = valid(session, { amount: '10.00', currency_amount: '10.00', val_id: 'VAL-cheap' });
  gw.validations.set(cheap.val_id, cheap);
  const back = await call('/api/pay/sslcommerz/success', { method: 'POST', form: { tran_id: session.tran_id, val_id: cheap.val_id } });
  assert.match(back.headers.get('location'), /payment=failed/);
  assert.equal(db.order(o.id).paymentStatus, 'failed');

  const retry = await call(`/api/orders/${o.id}/pay`, { method: 'POST', body: { phone: '01912345678' } });
  assert.equal(retry.status, 200);
  const second = gw.sessions.at(-1);
  assert.notEqual(second.tran_id, session.tran_id, 'each attempt has its own transaction id');
  // The old transaction can no longer mark the order paid.
  const old = valid(session, { val_id: 'VAL-old' });
  gw.validations.set(old.val_id, old);
  await call('/api/pay/sslcommerz/ipn', { method: 'POST', form: { tran_id: session.tran_id, val_id: old.val_id, status: 'VALID' } });
  assert.notEqual(db.order(o.id).paymentStatus, 'paid');

  assert.equal((await call(`/api/orders/${o.id}/cash`, { method: 'POST', body: { phone: '01700000000' } })).status, 404, 'needs the right phone');
  const cash = await call(`/api/orders/${o.id}/cash`, { method: 'POST', body: { phone: '01912345678' } });
  assert.equal(cash.status, 200);
  assert.equal(cash.data.order.payment, 'Cash on delivery');
  assert.equal(cash.data.order.paymentStatus, 'cod');
});

test('online payment: cancel and failure send the customer back to their order', async () => {
  const r = await call('/api/orders', { method: 'POST', body: order({ payment: 'Online payment' }) });
  const session = gw.sessions.at(-1);
  const cancel = await call('/api/pay/sslcommerz/cancel', { method: 'POST', form: { tran_id: session.tran_id } });
  assert.equal(cancel.headers.get('location'), `/order.html?id=${r.data.order.id}&payment=cancelled`);
  assert.equal(db.order(r.data.order.id).paymentStatus, 'failed');
  const unknown = await call('/api/pay/sslcommerz/fail', { method: 'POST', form: { tran_id: 'nope' } });
  assert.equal(unknown.headers.get('location'), '/track.html');

  gw.failNext = true;
  const down = await call('/api/orders', { method: 'POST', body: order({ payment: 'Online payment' }) });
  assert.equal(down.status, 201, 'the order is kept when the gateway is down');
  assert.equal(down.data.payUrl, undefined);
  assert.match(down.data.payError, /could not open/);
  assert.equal(down.data.order.paymentStatus, 'failed');
});

test('online payment is refused for chairs priced on request', async () => {
  const cookie = await login();
  await call('/api/admin/variants/c-2301-full-black', { method: 'PATCH', cookie, body: { price: null, salePrice: null } });
  const r = await call('/api/orders', { method: 'POST', body: order({ payment: 'Online payment' }) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /priced on request/);
  await call('/api/admin/variants/c-2301-full-black', { method: 'PATCH', cookie, body: { price: 9000 } });
});

test('unpaid online orders are cancelled after a day and the chairs return', async () => {
  const before = await stockOf('c-2301-full-black');
  const r = await call('/api/orders', { method: 'POST', body: order({ payment: 'Online payment', items: [{ id: 'c-2301-full-black', qty: 2 }] }) });
  assert.equal(await stockOf('c-2301-full-black'), before - 2);
  assert.deepEqual(db.expireUnpaid(24), [], 'not yet');
  db.raw.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3600000).toISOString(), r.data.order.id);
  assert.deepEqual(db.expireUnpaid(24), [r.data.order.id]);
  assert.equal(db.order(r.data.order.id).status, 'cancelled');
  assert.equal(await stockOf('c-2301-full-black'), before);
});

test('pages carry search and sharing tags; robots and sitemap', async () => {
  const p = await call('/product.html?m=6801a');
  assert.match(p.data, /<title>6801A Executive chair · DECOTURE – A brand of Sigma Synchrony<\/title>/);
  assert.match(p.data, /<link rel="canonical" href="https:\/\/decoture\.example\/product\.html\?m=6801a">/);
  assert.match(p.data, /<meta property="og:image" content="https:\/\/decoture\.example\/assets\/img\/products\//);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(p.data)[1]);
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.offers.priceCurrency, 'BDT');
  assert.equal(ld.offers.lowPrice, 37500);
  const home = await call('/');
  assert.match(home.data, /"@type":"FurnitureStore"/);
  assert.match(home.data, /rel="canonical" href="https:\/\/decoture\.example\/"/);
  const shop = await call('/shop.html?collection=task');
  assert.match(shop.data, /<title>Task &amp; office chairs · DECOTURE – A brand of Sigma Synchrony<\/title>/);
  assert.match((await call('/checkout.html')).data, /<meta name="robots" content="noindex">/);
  const missing = await call('/product.html?m=<script>');
  assert.doesNotMatch(missing.data, /<script>"/);
  const robots = await call('/robots.txt');
  assert.match(robots.data, /Disallow: \/admin\//);
  assert.match(robots.data, /Sitemap: https:\/\/decoture\.example\/sitemap\.xml/);
  const map = await call('/sitemap.xml');
  assert.match(map.headers.get('content-type'), /xml/);
  assert.equal((map.data.match(/<loc>/g) || []).length, 5 + 5 + 52);
  assert.match(map.data, /product\.html\?m=6801a/);
});
