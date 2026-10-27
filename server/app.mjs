// The Decoture web server: serves the storefront, a live catalog from the database, the order
// and quote API, and the admin panel with its API. Plain node:http, no packages.
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { catalogScript, COLLECTIONS } from '../lib/catalog.mjs';
import { HttpError, ORDER_STATUSES, QUOTE_STATUSES } from './db.mjs';
import { hashPassword, hashToken, newToken, parseCookies, SESSION_COOKIE, SESSION_DAYS, sessionCookie, verifyPassword } from './auth.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const PAYMENTS = ['Cash on delivery'];
const BD_MOBILE = /^(?:\+?88)?(01[3-9]\d{8})$/;
export const normalizePhone = (s) => {
  const m = String(s || '').replace(/[\s()-]/g, '').match(BD_MOBILE);
  return m ? m[1] : null;
};

// ---------- Small helpers ----------
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That upload is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const raw = await readBody(req, limit);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'That request was not valid JSON.'); }
}

const text = (v, max, { required = false, label = 'This field' } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${label} is required.`, { field: label });
  if (s.length > max) throw new HttpError(400, `${label} is too long.`, { field: label });
  return s;
};
const intOrNull = (v, { min = 0, max = 10_000_000, label }) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
};

// Fixed-window rate limits kept in memory: enough for one server process.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) { hits.set(key, { n: 1, reset: t + windowMs }); return true; }
    h.n += 1;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    return h.n <= max;
  };
}

const money = (n) => `Tk ${Math.round(n).toLocaleString('en-IN')}`;
function orderText(o, siteUrl) {
  return [
    `Order ${o.id}`,
    '',
    ...o.items.map((i) => `- ${i.qty} x ${i.sku}${i.price != null ? ` @ ${money(i.price)}` : ''}`),
    '',
    `Subtotal: ${money(o.subtotal)}${o.unpriced ? ' + items priced on confirmation' : ''}`,
    `Delivery: ${o.delivery}`,
    `Payment: ${o.payment}`,
    '',
    `Name: ${o.name}`,
    `Phone: ${o.phone}`,
    o.email ? `Email: ${o.email}` : null,
    `Address: ${o.address}, ${o.area}, ${o.district}`,
    o.note ? `Note: ${o.note}` : null,
    siteUrl ? `\nTrack it: ${siteUrl}/track.html?id=${encodeURIComponent(o.id)}` : null,
  ].filter((l) => l !== null).join('\n');
}

// What a customer may see about their own order: no internal note.
const publicOrder = (o) => ({
  id: o.id, createdAt: o.createdAt, status: o.status, items: o.items, subtotal: o.subtotal, unpriced: o.unpriced,
  delivery: o.delivery, payment: o.payment, name: o.name, district: o.district, area: o.area,
  events: o.events.map((e) => ({ at: e.at, status: e.status, note: e.note })),
});

const STATUS_WORDS = {
  confirmed: 'is confirmed. We will deliver it soon',
  shipped: 'is on its way to you',
  delivered: 'has been delivered. Thank you for choosing Decoture',
  cancelled: 'has been cancelled. Call us if this is a surprise',
};

export function createApp({ db, root, uploadsDir, mailer, config = {}, log = console }) {
  const siteRoot = resolve(root);
  const uploadsRoot = resolve(uploadsDir);
  mkdirSync(join(uploadsRoot, 'products'), { recursive: true });
  const limits = {
    order: limiter(config.orderLimit || 30, 60 * 60 * 1000),
    quote: limiter(config.orderLimit || 30, 60 * 60 * 1000),
    track: limiter(40, 10 * 60 * 1000),
    login: limiter(10, 15 * 60 * 1000),
  };
  const clientIp = (req) => (config.trustProxy && req.headers['x-forwarded-for']
    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : req.socket.remoteAddress || '');
  const isHttps = (req) => !!req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https');

  // ---------- Admin session ----------
  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const s = db.session(hashToken(token));
    return s ? db.adminById(s.admin_id) : null;
  }
  const requireAdmin = (req) => {
    const a = currentAdmin(req);
    if (!a) throw new HttpError(401, 'Please log in again.');
    return a;
  };

  // ---------- Routes ----------
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/assets\/js\/catalog\.js$/, (req, res) => {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(catalogScript({ ...db.catalog(), live: true }, 'Served live from the Decoture database.'));
  });
  route('GET', /^\/api\/catalog$/, (req, res) => send(res, 200, db.catalog()));
  route('GET', /^\/api\/health$/, (req, res) => send(res, 200, { ok: true }));

  route('POST', /^\/api\/orders$/, async (req, res) => {
    if (!limits.order(clientIp(req))) throw new HttpError(429, 'Too many orders from this connection. Please call us instead.');
    const b = await readJson(req);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new HttpError(400, 'Please enter a Bangladeshi mobile number, for example 01712345678.', { field: 'phone' });
    const email = text(b.email, 120, { label: 'Email' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please check the email address.', { field: 'email' });
    const payment = text(b.payment || PAYMENTS[0], 40, { label: 'Payment' });
    if (!PAYMENTS.includes(payment)) throw new HttpError(400, 'Cash on delivery is the only payment method for now.', { field: 'payment' });
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) throw new HttpError(400, 'Your cart is empty.');
    const merged = new Map();
    for (const it of b.items) {
      const id = text(it && it.id, 80, { required: true, label: 'Product' });
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 500) throw new HttpError(400, 'Quantities must be between 1 and 500.');
      merged.set(id, (merged.get(id) || 0) + qty);
    }
    const district = text(b.district, 60, { required: true, label: 'District' });
    const order = db.createOrder({
      name: text(b.name, 80, { required: true, label: 'Name' }),
      phone, email, district,
      area: text(b.area, 80, { required: true, label: 'Area' }),
      address: text(b.address, 200, { required: true, label: 'Address' }),
      note: text(b.note, 500, { label: 'Note' }),
      payment,
      delivery: district === 'Dhaka' ? 'Inside Dhaka, charge confirmed by phone' : 'Outside Dhaka, charge confirmed by phone',
      items: [...merged].map(([id, qty]) => ({ id, qty })),
    });
    const body = orderText(order, config.siteUrl);
    mailer.notify({ to: config.mailTo, subject: `New order ${order.id} from ${order.name}`, text: body, replyTo: order.email || undefined });
    if (order.email) {
      mailer.notify({ to: order.email, subject: `Your Decoture order ${order.id}`, text: `Thank you, ${order.name}. We have your order and will call ${order.phone} to confirm it.\n\n${body}` });
    }
    send(res, 201, { order: publicOrder(order) });
  });

  route('GET', /^\/api\/orders\/([A-Z0-9-]{6,24})$/, (req, res, [id], url) => {
    if (!limits.track(clientIp(req))) throw new HttpError(429, 'Too many lookups. Please try again in a few minutes.');
    const o = db.order(id);
    const phone = normalizePhone(url.searchParams.get('phone'));
    // The same answer for a wrong id and a wrong phone, so order ids cannot be probed.
    if (!o || !phone || o.phone !== phone) throw new HttpError(404, 'We could not find an order with that number and phone.');
    send(res, 200, { order: publicOrder(o) });
  });

  route('POST', /^\/api\/quotes$/, async (req, res) => {
    if (!limits.quote(clientIp(req))) throw new HttpError(429, 'Too many requests from this connection. Please call us instead.');
    const b = await readJson(req);
    const phone = text(b.phone, 30, { required: true, label: 'Phone' });
    if (!/^[+\d][\d\s-]{6,}$/.test(phone)) throw new HttpError(400, 'Please add a phone number we can call.', { field: 'phone' });
    const quote = db.addQuote({
      company: text(b.company, 120, { label: 'Company' }),
      name: text(b.name, 80, { required: true, label: 'Name' }),
      phone,
      email: text(b.email, 120, { label: 'Email' }),
      items: text(b.items, 2000, { label: 'Chairs' }),
      city: text(b.city, 60, { label: 'City' }),
      neededBy: text(b.neededBy, 20, { label: 'Date' }),
    });
    mailer.notify({
      to: config.mailTo,
      subject: `Quote request from ${quote.company || quote.name}`,
      text: [`Company: ${quote.company || '-'}`, `Contact: ${quote.name}, ${quote.phone}${quote.email ? ', ' + quote.email : ''}`, `Chairs: ${quote.items || '-'}`, `City: ${quote.city || '-'}`, `Needed by: ${quote.needed_by || '-'}`].join('\n'),
      replyTo: quote.email || undefined,
    });
    send(res, 201, { ok: true, id: quote.id });
  });

  // ---------- Admin API ----------
  route('POST', /^\/api\/admin\/login$/, async (req, res) => {
    if (!limits.login(clientIp(req))) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
    const b = await readJson(req);
    const admin = db.adminByName(String(b.username || '').trim().toLowerCase());
    if (!admin || !verifyPassword(String(b.password || ''), admin.pass_hash)) throw new HttpError(401, 'That username and password do not match.');
    const token = newToken();
    db.pruneSessions();
    db.addSession(hashToken(token), admin.id, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
    send(res, 200, { username: admin.username }, { 'Set-Cookie': sessionCookie(token, { secure: isHttps(req) }) });
  });
  route('POST', /^\/api\/admin\/logout$/, (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.dropSession(hashToken(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { secure: isHttps(req), clear: true }) });
  });
  route('GET', /^\/api\/admin\/me$/, (req, res) => send(res, 200, { username: requireAdmin(req).username }));
  route('POST', /^\/api\/admin\/password$/, async (req, res) => {
    const admin = requireAdmin(req);
    const b = await readJson(req);
    if (!verifyPassword(String(b.current || ''), admin.pass_hash)) throw new HttpError(400, 'Your current password is not right.', { field: 'current' });
    const next = String(b.next || '');
    if (next.length < 10) throw new HttpError(400, 'Use at least 10 characters for the new password.', { field: 'next' });
    db.setPassword(admin.id, hashPassword(next));
    db.dropSessionsFor(admin.id);
    const token = newToken();
    db.addSession(hashToken(token), admin.id, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, { secure: isHttps(req) }) });
  });

  route('GET', /^\/api\/admin\/summary$/, (req, res) => { requireAdmin(req); send(res, 200, db.summary()); });
  route('GET', /^\/api\/admin\/orders$/, (req, res, _, url) => {
    requireAdmin(req);
    const status = url.searchParams.get('status');
    send(res, 200, { orders: db.orders({ status: ORDER_STATUSES.includes(status) ? status : undefined }) });
  });
  route('GET', /^\/api\/admin\/orders\.csv$/, (req, res) => {
    requireAdmin(req);
    const cell = (v) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no formulas when opened in Excel
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const rows = [['Order', 'Date', 'Status', 'Name', 'Phone', 'Email', 'District', 'Area', 'Address', 'Items', 'Subtotal', 'Note']];
    db.orders({ limit: 100000 }).forEach((o) => rows.push([o.id, o.createdAt, o.status, o.name, o.phone, o.email, o.district, o.area, o.address,
      o.items.map((i) => `${i.qty} x ${i.sku}`).join('; '), o.subtotal, o.note]));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="decoture-orders.csv"', 'Cache-Control': 'no-store' });
    res.end('﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'));
  });
  route('GET', /^\/api\/admin\/orders\/([A-Z0-9-]{6,24})$/, (req, res, [id]) => {
    requireAdmin(req);
    const o = db.order(id);
    if (!o) throw new HttpError(404, 'No such order.');
    send(res, 200, { order: o });
  });
  route('PATCH', /^\/api\/admin\/orders\/([A-Z0-9-]{6,24})$/, async (req, res, [id]) => {
    requireAdmin(req);
    const b = await readJson(req);
    if (b.status != null && !ORDER_STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status.');
    const before = db.order(id);
    const o = db.updateOrder(id, {
      status: b.status || undefined,
      adminNote: b.adminNote == null ? undefined : text(b.adminNote, 2000, { label: 'Note' }),
      note: text(b.note, 300, { label: 'Message' }),
    });
    if (before && o.status !== before.status && o.email && STATUS_WORDS[o.status]) {
      mailer.notify({
        to: o.email,
        subject: `Decoture order ${o.id}: ${o.status}`,
        text: `Hello ${o.name},\n\nYour order ${o.id} ${STATUS_WORDS[o.status]}.${b.note ? `\n\n${b.note}` : ''}\n\nQuestions? Call ${config.phone || '+880 1791 978775'}.`,
      });
    }
    send(res, 200, { order: o });
  });

  route('GET', /^\/api\/admin\/variants$/, (req, res) => { requireAdmin(req); send(res, 200, { variants: db.variants(), collections: Object.fromEntries(Object.entries(COLLECTIONS).map(([k, v]) => [k, v.name])) }); });
  route('PATCH', /^\/api\/admin\/variants\/([a-z0-9-]{1,80})$/, async (req, res, [id]) => {
    requireAdmin(req);
    const b = await readJson(req);
    const patch = {};
    if ('price' in b) patch.price = intOrNull(b.price, { max: 10_000_000, label: 'Price' });
    if ('salePrice' in b) patch.salePrice = intOrNull(b.salePrice, { max: 10_000_000, label: 'Sale price' });
    if ('stock' in b) {
      const s = intOrNull(b.stock, { max: 1_000_000, label: 'Stock' });
      if (s == null) throw new HttpError(400, 'Stock must be a whole number from 0 to 1000000.');
      patch.stock = s;
    }
    if ('active' in b) patch.active = !!b.active;
    if ('swatch' in b) {
      if (!/^#[0-9a-f]{6}$/i.test(String(b.swatch))) throw new HttpError(400, 'Pick a colour for the swatch.');
      patch.swatch = b.swatch;
    }
    const current = db.variant(id);
    if (!current) throw new HttpError(404, 'No such product.');
    const price = 'price' in patch ? patch.price : current.price;
    const sale = 'salePrice' in patch ? patch.salePrice : current.salePrice;
    if (sale != null && price != null && sale >= price) throw new HttpError(400, 'The sale price must be lower than the regular price.');
    send(res, 200, { variant: db.updateVariant(id, patch) });
  });
  route('POST', /^\/api\/admin\/variants$/, async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);
    const collection = String(b.collection || '');
    if (!COLLECTIONS[collection]) throw new HttpError(400, 'Choose a collection.');
    if (b.swatch != null && b.swatch !== '' && !/^#[0-9a-f]{6}$/i.test(String(b.swatch))) throw new HttpError(400, 'Pick a colour for the swatch.');
    const v = db.addVariant({
      model: text(b.model, 40, { required: true, label: 'Model' }).toUpperCase(),
      colour: text(b.colour, 40, { required: true, label: 'Colour' }).replace(/\b\w/g, (c) => c.toUpperCase()),
      collection,
      swatch: b.swatch || null,
      stock: intOrNull(b.stock ?? 0, { max: 1_000_000, label: 'Stock' }) ?? 0,
      warrantyYears: intOrNull(b.warrantyYears ?? 2, { max: 10, label: 'Warranty' }),
      price: intOrNull(b.price, { label: 'Price' }),
      salePrice: intOrNull(b.salePrice, { label: 'Sale price' }),
    });
    send(res, 201, { variant: v });
  });
  route('POST', /^\/api\/admin\/variants\/([a-z0-9-]{1,80})\/image$/, async (req, res, [id]) => {
    requireAdmin(req);
    if (!db.variant(id)) throw new HttpError(404, 'No such product.');
    const b = await readJson(req, 9 * 1024 * 1024);
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw new HttpError(400, 'Upload a JPG, PNG or WebP photo.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'Photos can be up to 6 MB.');
    const magic = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
    if (!magic.every((byte, i) => buf[i] === byte)) throw new HttpError(400, 'That file is not a real image.');
    const name = `${id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    writeFileSync(join(uploadsRoot, 'products', name), buf);
    send(res, 200, { variant: db.updateVariant(id, { image: `uploads/products/${name}` }) });
  });

  route('GET', /^\/api\/admin\/quotes$/, (req, res) => { requireAdmin(req); send(res, 200, { quotes: db.quotes() }); });
  route('PATCH', /^\/api\/admin\/quotes\/(\d{1,9})$/, async (req, res, [id]) => {
    requireAdmin(req);
    const b = await readJson(req);
    if (!QUOTE_STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status.');
    send(res, 200, { quote: db.updateQuote(Number(id), b.status) });
  });

  // ---------- Static files ----------
  function serveFile(req, res, file, cache) {
    let st;
    try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', ETag: etag, 'Cache-Control': cache };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(file).pipe(res);
    return true;
  }
  // Only the storefront pages, assets, admin panel and uploaded photos are public:
  // never the database, server code, data files or the git folder.
  function staticFile(pathname) {
    let p;
    try { p = decodeURIComponent(pathname); } catch { return null; }
    if (p.includes('\0')) return null;
    if (p === '/' ) return { base: siteRoot, rel: 'index.html' };
    if (p === '/admin' || p === '/admin/') return { base: siteRoot, rel: 'admin/index.html' };
    if (/^\/[a-z0-9-]+\.html$/.test(p)) return { base: siteRoot, rel: p.slice(1) };
    if (p.startsWith('/assets/') || p.startsWith('/admin/')) return { base: siteRoot, rel: p.slice(1) };
    if (p.startsWith('/uploads/')) return { base: uploadsRoot, rel: p.slice('/uploads/'.length) };
    return null;
  }

  return async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    const url = new URL(req.url, 'http://localhost');
    try {
      // Writes must come from this site's own pages.
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.origin;
        let host = null;
        try { host = origin ? new URL(origin).host : null; } catch { /* "null" or junk */ }
        if (origin && host !== req.headers.host) throw new HttpError(403, 'Cross-site request refused.');
      }
      for (const r of routes) {
        const m = r.pattern.exec(url.pathname);
        if (m && (r.method === req.method || (r.method === 'GET' && req.method === 'HEAD'))) {
          await r.handler(req, res, m.slice(1), url);
          return;
        }
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      const target = staticFile(url.pathname);
      if (target) {
        const file = normalize(join(target.base, target.rel));
        if (file.startsWith(target.base + sep)) {
          const cache = /\.(jpe?g|png|webp|svg|woff2)$/i.test(file) ? 'public, max-age=604800' : 'no-cache';
          if (serveFile(req, res, file, cache)) return;
        }
      }
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end('<!doctype html><meta charset="utf-8"><title>Not found · Decoture</title><p style="font-family:sans-serif;padding:40px">Page not found. <a href="/">Go to the Decoture home page</a>.</p>');
    } catch (e) {
      if (e instanceof HttpError) {
        const { status, message, ...extra } = e;
        delete extra.stack;
        send(res, status, { error: message, ...extra });
      } else {
        log.error(e);
        if (!res.headersSent) send(res, 500, { error: 'Something went wrong on our side. Please try again or call us.' });
        else res.end();
      }
    }
  };
}
