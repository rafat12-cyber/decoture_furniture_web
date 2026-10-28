// End-to-end tests for the store server: run with `npm test` (Node 22.5+).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { createMailer } from '../server/mail.mjs';
import { hashPassword } from '../server/auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { error() {}, log() {} };
let dir; let db; let server; let base; let smtp; const mails = [];

// A tiny fake SMTP server that records what the store sends.
function fakeSmtp() {
  return net.createServer((sock) => {
    sock.setEncoding('utf8');
    let data = false; let buf = '';
    sock.write('220 fake\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; mails.push(mails.current); sock.write('250 queued\r\n'); } else mails.current += `${line}\n`;
          continue;
        }
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'DATA') { data = true; mails.current = ''; sock.write('354 go\r\n'); } else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); } else sock.write('250 ok\r\n');
      }
    });
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'decoture-test-'));
  db = openDb(join(dir, 'test.db'), { seedCsv: join(root, 'data', 'stock.csv') });
  db.addAdmin('admin', hashPassword('correct horse battery'));
  smtp = fakeSmtp();
  await new Promise((r) => smtp.listen(0, r));
  const mailer = createMailer({ host: '127.0.0.1', port: smtp.address().port, secure: false, from: 'shop@decoture.test' }, quiet);
  const app = createApp({ db, root, uploadsDir: join(dir, 'uploads'), mailer, config: { mailTo: 'orders@decoture.test', orderLimit: 1000 }, log: quiet });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); smtp.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
};
const order = (over = {}) => ({
  name: 'Rahim Uddin', phone: '01712-345678', email: '', district: 'Dhaka', area: 'Mirpur 10', address: 'House 5, Road 3',
  payment: 'Cash on delivery', items: [{ id: '6801a-silver', qty: 2 }], ...over,
});
const stockOf = async (id) => {
  const { data } = await call('/api/catalog');
  for (const p of data.products) for (const v of p.variants) if (v.id === id) return v.stock;
  return undefined;
};
async function waitFor(fn, ms = 2000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
    const v = fn();
    if (v) return v;
  }
  return fn();
}
async function login() {
  const r = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'correct horse battery' } });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

test('serves the storefront and a live catalog from the database', async () => {
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.data, /Style\. Comfort\./);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  const js = await call('/assets/js/catalog.js');
  assert.match(js.data, /"live": true/);
  const { data } = await call('/api/catalog');
  assert.equal(data.products.length, 52);
  assert.equal(data.products.reduce((n, p) => n + p.variants.length, 0), 82);
});

test('never serves the database, data files, server code or git', async () => {
  for (const p of ['/data/stock.csv', '/data/runtime/decoture.db', '/server/app.mjs', '/.git/config', '/package.json', '/assets/../server/db.mjs', '/assets/%2e%2e/server/db.mjs', '/uploads/../test.db']) {
    const res = await fetch(base + p, { redirect: 'manual' }).catch(() => null);
    // fetch normalises plain ../ itself, so also send the raw path over http
    const raw = await new Promise((r) => http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res2) => { res2.resume(); r(res2.statusCode); }));
    assert.equal(raw, 404, p);
    if (res) assert.notEqual(res.status, 200, p);
  }
});

test('places an order with server prices and holds the stock', async () => {
  const before = await stockOf('6801a-silver');
  const r = await call('/api/orders', { method: 'POST', body: order({ items: [{ id: '6801a-silver', qty: 2, price: 1 }] }) });
  assert.equal(r.status, 201);
  assert.match(r.data.order.id, /^DC-\d{6}-[A-Z0-9]{4}$/);
  assert.equal(r.data.order.subtotal, 75000, 'price comes from the database, not the request');
  assert.equal(r.data.order.items[0].price, 37500);
  assert.equal(r.data.order.phone, undefined, 'phone is not echoed in the public view');
  assert.equal(await stockOf('6801a-silver'), before - 2);
  const mail = await waitFor(() => mails.find((m) => m.includes('Subject: New order')));
  assert.ok(mail, 'the shop is emailed');
  assert.match(Buffer.from(mail.split('\n\n')[1].replace(/\s/g, ''), 'base64').toString(), /2 x Monarch 6801A Silver @ Tk 37,500/);
});

test('refuses to sell more than is in stock', async () => {
  const stock = await stockOf('6801b-silver');
  const r = await call('/api/orders', { method: 'POST', body: order({ items: [{ id: '6801b-silver', qty: stock + 1 }] }) });
  assert.equal(r.status, 409);
  assert.equal(r.data.variant, '6801b-silver');
  assert.equal(r.data.available, stock);
  assert.equal(await stockOf('6801b-silver'), stock, 'nothing is taken when the order fails');
  const out = await call('/api/orders', { method: 'POST', body: order({ items: [{ id: 'cds-155-m-pvc-base', qty: 1 }] }) });
  assert.equal(out.status, 409, 'out of stock');
});

test('validates the order form', async () => {
  const cases = [
    [{ phone: '12345' }, /mobile number/],
    [{ name: '' }, /Name is required/],
    [{ items: [] }, /cart is empty/],
    [{ items: [{ id: 'nope', qty: 1 }] }, /no longer available/],
    [{ items: [{ id: '6801a-silver', qty: 0 }] }, /between 1 and 500/],
    [{ payment: 'Card' }, /cash on delivery/i],
    [{ payment: 'Online payment' }, /cash on delivery/i],
    [{ district: 'Atlantis' }, /district/],
    [{ email: 'not-an-email' }, /email/],
  ];
  for (const [over, msg] of cases) {
    const r = await call('/api/orders', { method: 'POST', body: order(over) });
    assert.ok(r.status === 400 || r.status === 409, JSON.stringify(over));
    assert.match(r.data.error, msg);
  }
  const notJson = await fetch(`${base}/api/orders`, { method: 'POST', body: 'name=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(notJson.status, 415, 'plain form posts are refused');
  const cross = await call('/api/orders', { method: 'POST', body: order(), headers: { origin: 'https://evil.example' } });
  assert.equal(cross.status, 403, 'cross-site posts are refused');
  const nullOrigin = await call('/api/orders', { method: 'POST', body: order(), headers: { origin: 'null' } });
  assert.equal(nullOrigin.status, 403, 'sandboxed frames are refused');
});

test('customers track an order only with the matching phone', async () => {
  const { data } = await call('/api/orders', { method: 'POST', body: order({ phone: '+8801812345678' }) });
  const id = data.order.id;
  const ok = await call(`/api/orders/${id}?phone=01812 345678`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.order.status, 'new');
  assert.equal(ok.data.order.adminNote, undefined);
  assert.equal((await call(`/api/orders/${id}?phone=01712345678`)).status, 404);
  assert.equal((await call(`/api/orders/${id}`)).status, 404);
  assert.equal((await call('/api/orders/DC-000000-ZZZZ?phone=01812345678')).status, 404);
});

test('admin API needs a login, and a wrong password is refused', async () => {
  for (const [m, p] of [['GET', '/api/admin/orders'], ['GET', '/api/admin/summary'], ['PATCH', '/api/admin/variants/6801a-silver'], ['GET', '/api/admin/orders.csv']]) {
    const r = await call(p, { method: m, body: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  const bad = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const cookie = await login();
  assert.match(cookie, /^dc_admin=/);
  assert.equal((await call('/api/admin/me', { cookie })).data.username, 'admin');
  const r = await call('/api/admin/logout', { method: 'POST', cookie });
  assert.equal(r.status, 200);
  assert.equal((await call('/api/admin/me', { cookie })).status, 401, 'logged-out sessions stop working');
});

test('admin updates order status; cancelling returns the stock', async () => {
  const cookie = await login();
  const before = await stockOf('6856a-sand');
  const { data } = await call('/api/orders', { method: 'POST', body: order({ email: 'rahim@example.com', items: [{ id: '6856a-sand', qty: 3 }] }) });
  const id = data.order.id;
  assert.equal(await stockOf('6856a-sand'), before - 3);
  const conf = await call(`/api/admin/orders/${id}`, { method: 'PATCH', cookie, body: { status: 'confirmed', note: 'Delivery on Thursday', adminNote: 'VIP' } });
  assert.equal(conf.data.order.status, 'confirmed');
  assert.equal(conf.data.order.adminNote, 'VIP');
  const track = await call(`/api/orders/${id}?phone=01712345678`);
  assert.equal(track.data.order.events.at(-1).note, 'Delivery on Thursday');
  await call(`/api/admin/orders/${id}`, { method: 'PATCH', cookie, body: { status: 'cancelled' } });
  assert.equal(await stockOf('6856a-sand'), before, 'cancelled chairs go back to stock');
  await call(`/api/admin/orders/${id}`, { method: 'PATCH', cookie, body: { status: 'confirmed' } });
  assert.equal(await stockOf('6856a-sand'), before - 3, 'reopening holds them again');
  assert.equal((await call(`/api/admin/orders/${id}`, { method: 'PATCH', cookie, body: { status: 'lost' } })).status, 400);
  assert.ok(await waitFor(() => mails.some((m) => m.includes('To: rahim@example.com') && m.includes('confirmed'))), 'customer is emailed the status');
  const csv = await call('/api/admin/orders.csv', { cookie });
  assert.match(csv.data, new RegExp(id));
});

test('admin edits price, sale price, stock and visibility, and the store shows it', async () => {
  const cookie = await login();
  const r = await call('/api/admin/variants/6801a-silver', { method: 'PATCH', cookie, body: { price: 12500, salePrice: 9900, stock: 40 } });
  assert.equal(r.status, 200);
  const cat = (await call('/api/catalog')).data;
  const v = cat.products.find((p) => p.slug === '6801a').variants[0];
  assert.deepEqual([v.price, v.salePrice, v.stock], [12500, 9900, 40]);
  const o = await call('/api/orders', { method: 'POST', body: order({ items: [{ id: '6801a-silver', qty: 1 }] }) });
  assert.equal(o.data.order.subtotal, 9900, 'orders use the sale price');
  assert.equal((await call('/api/admin/variants/6801a-silver', { method: 'PATCH', cookie, body: { salePrice: 13000 } })).status, 400, 'sale must be below price');
  assert.equal((await call('/api/admin/variants/6801a-silver', { method: 'PATCH', cookie, body: { stock: -1 } })).status, 400);
  await call('/api/admin/variants/6801a-silver', { method: 'PATCH', cookie, body: { active: false } });
  assert.ok(!(await call('/api/catalog')).data.products.some((p) => p.slug === '6801a'), 'hidden chairs leave the store');
  assert.equal((await call('/api/orders', { method: 'POST', body: order({ items: [{ id: '6801a-silver', qty: 1 }] }) })).status, 409);
  await call('/api/admin/variants/6801a-silver', { method: 'PATCH', cookie, body: { active: true } });
});

test('admin adds a colourway and uploads a photo', async () => {
  const cookie = await login();
  const add = await call('/api/admin/variants', { method: 'POST', cookie, body: { model: 'gx-9', colour: 'black', collection: 'ergonomic', price: 15000, stock: 12, swatch: '#111111' } });
  assert.equal(add.status, 201);
  assert.equal(add.data.variant.id, 'gx-9-black');
  assert.equal((await call('/api/admin/variants', { method: 'POST', cookie, body: { model: 'GX-9', colour: 'Black', collection: 'ergonomic' } })).status, 409);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString('base64');
  const up = await call('/api/admin/variants/gx-9-black/image', { method: 'POST', cookie, body: { dataUrl: `data:image/jpeg;base64,${jpeg}` } });
  assert.equal(up.status, 200);
  assert.match(up.data.variant.image, /^uploads\/products\/gx-9-black-\d+-[a-z0-9]+\.jpg$/);
  const img = await fetch(`${base}/${up.data.variant.image}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  const fake = await call('/api/admin/variants/gx-9-black/image', { method: 'POST', cookie, body: { dataUrl: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` } });
  assert.equal(fake.status, 400, 'files that are not really images are refused');
  const cat = (await call('/api/catalog')).data;
  assert.ok(cat.products.find((p) => p.slug === 'gx-9').variants[0].image.startsWith('uploads/'));
});

test('admin edits a chair: name, details, category and every angle photo', async () => {
  const cookie = await login();
  const before = await call('/api/admin/products/6801a', { cookie });
  assert.equal(before.data.product.name, 'Monarch 6801A');
  const put = await call('/api/admin/products/6801a', { method: 'PUT', cookie, body: { name: 'Imperial', features: 'Reclining back\nFootrest', description: 'A big leather chair.', collection: 'ergonomic', warrantyYears: 3 } });
  assert.equal(put.status, 200);
  assert.equal(put.data.product.name, 'Imperial 6801A');
  let p = (await call('/api/catalog')).data.products.find((x) => x.slug === '6801a');
  assert.equal(p.name, 'Imperial 6801A');
  assert.deepEqual(p.features, ['Reclining back', 'Footrest']);
  assert.equal(p.description, 'A big leather chair.');
  assert.equal(p.collection, 'ergonomic');
  assert.equal(p.warrantyYears, 3);
  assert.equal((await call('/api/admin/products/6801a', { method: 'PUT', cookie, body: { collection: 'sofas' } })).status, 400);
  await call('/api/admin/products/6801a', { method: 'PUT', cookie, body: {} });
  p = (await call('/api/catalog')).data.products.find((x) => x.slug === '6801a');
  assert.equal(p.name, 'Monarch 6801A', 'empty fields go back to the defaults');
  assert.equal(p.collection, 'executive');

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString('base64');
  const id = before.data.product.variants[0].id;
  const start = [before.data.product.variants[0].image, ...before.data.product.variants[0].gallery];
  const added = await call(`/api/admin/variants/${id}/photos`, { method: 'POST', cookie, body: { dataUrl: `data:image/jpeg;base64,${jpeg}` } });
  assert.equal(added.status, 200);
  const photos = [added.data.variant.image, ...added.data.variant.gallery];
  assert.deepEqual(photos.slice(0, -1), start, 'a new photo is added after the others');
  const reordered = [photos.at(-1), ...photos.slice(0, -1)];
  const set = await call(`/api/admin/variants/${id}/photos`, { method: 'PUT', cookie, body: { photos: reordered.slice(0, 2) } });
  assert.equal(set.data.variant.image, reordered[0], 'the first photo is the main one');
  assert.deepEqual(set.data.variant.gallery, [reordered[1]]);
  assert.equal((await call(`/api/admin/variants/${id}/photos`, { method: 'PUT', cookie, body: { photos: ['../../etc/passwd'] } })).status, 400);
  const v = (await call('/api/catalog')).data.products.find((x) => x.slug === '6801a').variants.find((x) => x.id === id);
  assert.deepEqual(v.gallery, reordered.slice(0, 2));
});

test('office quote requests are saved and listed for the admin', async () => {
  const r = await call('/api/quotes', { method: 'POST', body: { company: 'Acme', name: 'Karim', phone: '01811111111', items: '40 x C-758 Black' } });
  assert.equal(r.status, 201);
  assert.equal((await call('/api/quotes', { method: 'POST', body: { name: 'Karim', phone: 'abc' } })).status, 400);
  const cookie = await login();
  const list = await call('/api/admin/quotes', { cookie });
  assert.equal(list.data.quotes[0].company, 'Acme');
  const up = await call(`/api/admin/quotes/${list.data.quotes[0].id}`, { method: 'PATCH', cookie, body: { status: 'contacted' } });
  assert.equal(up.data.quote.status, 'contacted');
});

test('changing the password logs out other sessions', async () => {
  const a = await login();
  const b = await login();
  const bad = await call('/api/admin/password', { method: 'POST', cookie: a, body: { current: 'nope', next: 'a much longer password' } });
  assert.equal(bad.status, 400);
  const short = await call('/api/admin/password', { method: 'POST', cookie: a, body: { current: 'correct horse battery', next: 'short' } });
  assert.equal(short.status, 400);
  const ok = await call('/api/admin/password', { method: 'POST', cookie: a, body: { current: 'correct horse battery', next: 'a much longer password' } });
  assert.equal(ok.status, 200);
  const fresh = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/admin/me', { cookie: b })).status, 401);
  assert.equal((await call('/api/admin/me', { cookie: fresh })).status, 200);
  await call('/api/admin/password', { method: 'POST', cookie: fresh, body: { current: 'a much longer password', next: 'correct horse battery' } });
});

test('limits how many orders one connection can place', async () => {
  const app = createApp({ db, root, uploadsDir: join(dir, 'uploads'), mailer: createMailer({}), config: { orderLimit: 2 }, log: quiet });
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/orders`;
  const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order({ items: [{ id: 'c-2301-full-black', qty: 1 }] })) });
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429);
  srv.close();
});
