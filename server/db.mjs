// SQLite storage (node:sqlite, built into Node 22.5+): products, orders, quotes and admin sessions.
// On first run the variants table is seeded from data/stock.csv; after that the database is the
// source of truth and the admin panel edits it.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildCatalog, parseCsv, slug, swatchFor } from '../lib/catalog.mjs';

export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
export const QUOTE_STATUSES = ['new', 'contacted', 'closed'];

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS variants (
    id TEXT PRIMARY KEY,
    sl INTEGER NOT NULL,
    model TEXT NOT NULL,
    colour TEXT NOT NULL,
    collection TEXT NOT NULL,
    swatch TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    warranty_years INTEGER,
    features TEXT NOT NULL DEFAULT '',
    image TEXT,
    price_bdt INTEGER,
    sale_price_bdt INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL,
    area TEXT NOT NULL,
    address TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    payment TEXT NOT NULL,
    delivery TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    unpriced INTEGER NOT NULL DEFAULT 0,
    admin_note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at);
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price INTEGER,
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS order_events (
    order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    company TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    needed_by TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
`;

const now = () => new Date().toISOString();

// Columns added after the first release; older databases get them on start.
const ORDER_COLUMNS = {
  zone: "TEXT NOT NULL DEFAULT ''",
  delivery_fee: 'INTEGER NOT NULL DEFAULT 0',
  total: 'INTEGER NOT NULL DEFAULT 0',
  payment_status: "TEXT NOT NULL DEFAULT 'cod'",
  tran_id: "TEXT NOT NULL DEFAULT ''",
  paid_at: "TEXT NOT NULL DEFAULT ''",
  paid_amount: 'INTEGER',
  payment_ref: "TEXT NOT NULL DEFAULT ''",
};
export const PAYMENT_STATUSES = ['cod', 'pending', 'paid', 'failed'];

export function openDb(file, { seedCsv } = {}) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const have = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(ORDER_COLUMNS)) {
    if (!have.has(col)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${type}`);
      if (col === 'total') db.exec('UPDATE orders SET total = subtotal + delivery_fee');
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS orders_tran ON orders (tran_id)');
  const count = db.prepare('SELECT COUNT(*) AS n FROM variants').get().n;
  if (count === 0 && seedCsv) seed(db, parseCsv(readFileSync(seedCsv, 'utf8')));
  return wrap(db);
}

function seed(db, rows) {
  const insert = db.prepare(`INSERT INTO variants (id, sl, model, colour, collection, swatch, stock, warranty_years, features, image, price_bdt, sale_price_bdt, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const t = now();
  const n = (s) => (s === '' ? null : Number(s));
  tx(db, () => {
    for (const r of rows) {
      insert.run(slug(`${r.model}-${r.colour}`), Number(r.sl), r.model, r.colour, r.collection, swatchFor(r.colour),
        n(r.stock) ?? 0, n(r.warranty_years), r.features || '', r.image || null, n(r.price_bdt), n(r.sale_price_bdt), t);
    }
  });
}

// node:sqlite has no transaction helper; BEGIN IMMEDIATE takes the write lock up front.
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const variantRow = (v) => ({
  id: v.id, sl: v.sl, model: v.model, colour: v.colour, collection: v.collection, swatch: v.swatch, stock: v.stock,
  warrantyYears: v.warranty_years, features: v.features, image: v.image, price: v.price_bdt, salePrice: v.sale_price_bdt,
  active: !!v.active, updatedAt: v.updated_at,
});
const unitPrice = (v) => (v.sale_price_bdt != null ? v.sale_price_bdt : v.price_bdt);

function wrap(db) {
  const q = {
    variant: db.prepare('SELECT * FROM variants WHERE id = ?'),
    variants: db.prepare('SELECT * FROM variants ORDER BY sl'),
    activeVariants: db.prepare('SELECT * FROM variants WHERE active = 1 ORDER BY sl'),
    order: db.prepare('SELECT * FROM orders WHERE id = ?'),
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?'),
    events: db.prepare('SELECT at, status, note FROM order_events WHERE order_id = ? ORDER BY at, rowid'),
  };

  function orderWithItems(id) {
    const o = q.order.get(id);
    if (!o) return null;
    return {
      id: o.id, createdAt: o.created_at, updatedAt: o.updated_at, status: o.status,
      name: o.name, phone: o.phone, email: o.email, district: o.district, area: o.area, address: o.address, note: o.note,
      payment: o.payment, delivery: o.delivery, zone: o.zone, deliveryFee: o.delivery_fee, subtotal: o.subtotal, total: o.total,
      unpriced: o.unpriced, adminNote: o.admin_note,
      paymentStatus: o.payment_status, tranId: o.tran_id, paidAt: o.paid_at, paidAmount: o.paid_amount, paymentRef: o.payment_ref,
      items: q.items.all(id).map((i) => ({ id: i.variant_id, sku: i.sku, qty: i.qty, price: i.price, image: i.image })),
      events: q.events.all(id),
    };
  }

  const newOrderId = () => {
    const d = new Date();
    const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    for (;;) {
      const id = `DC-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      if (!q.order.get(id)) return id;
    }
  };

  return {
    raw: db,
    close: () => db.close(),

    // ---------- Catalog ----------
    catalog() {
      const rows = q.activeVariants.all().map((v) => ({ ...v, image: v.image || '' }));
      return buildCatalog(rows);
    },
    variants: () => q.variants.all().map(variantRow),
    variant: (id) => { const v = q.variant.get(id); return v ? variantRow(v) : null; },
    updateVariant(id, patch) {
      const v = q.variant.get(id);
      if (!v) throw new HttpError(404, 'No such product.');
      const next = {
        price_bdt: 'price' in patch ? patch.price : v.price_bdt,
        sale_price_bdt: 'salePrice' in patch ? patch.salePrice : v.sale_price_bdt,
        stock: 'stock' in patch ? patch.stock : v.stock,
        active: 'active' in patch ? (patch.active ? 1 : 0) : v.active,
        image: 'image' in patch ? patch.image : v.image,
        swatch: 'swatch' in patch ? patch.swatch : v.swatch,
      };
      db.prepare('UPDATE variants SET price_bdt = ?, sale_price_bdt = ?, stock = ?, active = ?, image = ?, swatch = ?, updated_at = ? WHERE id = ?')
        .run(next.price_bdt, next.sale_price_bdt, next.stock, next.active, next.image, next.swatch, now(), id);
      return variantRow(q.variant.get(id));
    },
    addVariant(v) {
      const id = slug(`${v.model}-${v.colour}`);
      if (q.variant.get(id)) throw new HttpError(409, `${v.model} ${v.colour} already exists.`);
      const sl = db.prepare('SELECT COALESCE(MAX(sl), 0) + 1 AS n FROM variants').get().n;
      db.prepare(`INSERT INTO variants (id, sl, model, colour, collection, swatch, stock, warranty_years, features, image, price_bdt, sale_price_bdt, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?)`)
        .run(id, sl, v.model, v.colour, v.collection, v.swatch || swatchFor(v.colour), v.stock, v.warrantyYears, v.price, v.salePrice, now());
      return variantRow(q.variant.get(id));
    },

    // ---------- Orders ----------
    // Prices and stock come from the database, never from the browser. Stock is held as soon as
    // the order is placed and given back if the order is cancelled.
    createOrder(input) {
      return tx(db, () => {
        const lines = [];
        for (const { id, qty } of input.items) {
          const v = q.variant.get(id);
          if (!v || !v.active) throw new HttpError(409, 'A chair in your cart is no longer available.', { variant: id, available: 0 });
          if (v.stock < qty) {
            throw new HttpError(409, v.stock > 0 ? `Only ${v.stock} of ${v.model} ${v.colour} left.` : `${v.model} ${v.colour} is out of stock.`, { variant: id, available: Math.max(0, v.stock) });
          }
          lines.push({ v, qty });
        }
        const id = newOrderId();
        const t = now();
        let subtotal = 0; let unpriced = 0;
        let chairs = 0;
        for (const { v, qty } of lines) {
          const p = unitPrice(v);
          chairs += qty;
          if (p == null) unpriced += qty; else subtotal += p * qty;
        }
        // The caller prices delivery from the real subtotal, and may refuse the order (for
        // example online payment with unpriced chairs) before anything is written.
        const d = input.delivery({ chairs, subtotal, unpriced });
        db.prepare(`INSERT INTO orders (id, created_at, updated_at, status, name, phone, email, district, area, address, note, payment, delivery, subtotal, unpriced, zone, delivery_fee, total, payment_status)
          VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, t, t, input.name, input.phone, input.email, input.district, input.area, input.address, input.note, input.payment,
            d.label, subtotal, unpriced, d.zone, d.fee, subtotal + d.fee, input.paymentStatus || 'cod');
        const addItem = db.prepare('INSERT INTO order_items (order_id, variant_id, sku, qty, price, image) VALUES (?, ?, ?, ?, ?, ?)');
        const take = db.prepare('UPDATE variants SET stock = stock - ?, updated_at = ? WHERE id = ?');
        for (const { v, qty } of lines) {
          addItem.run(id, v.id, `${v.model} ${v.colour}`, qty, unitPrice(v), v.image ? (v.image.includes('/') ? v.image : `assets/img/products/${v.image}`) : null);
          take.run(qty, t, v.id);
        }
        db.prepare('INSERT INTO order_events (order_id, at, status, note) VALUES (?, ?, ?, ?)').run(id, t, 'new', 'Order placed on the website');
        return orderWithItems(id);
      });
    },
    order: orderWithItems,
    orders({ status, limit = 200 } = {}) {
      const rows = status
        ? db.prepare('SELECT id FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
        : db.prepare('SELECT id FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map((r) => orderWithItems(r.id));
    },
    updateOrder(id, { status, adminNote, note }) {
      return tx(db, () => {
        const o = q.order.get(id);
        if (!o) throw new HttpError(404, 'No such order.');
        const t = now();
        if (status && status !== o.status) {
          const give = db.prepare('UPDATE variants SET stock = stock + ?, updated_at = ? WHERE id = ?');
          const take = db.prepare('UPDATE variants SET stock = stock - ?, updated_at = ? WHERE id = ?');
          // Cancelling returns the chairs to stock; reopening a cancelled order holds them again.
          if (status === 'cancelled') q.items.all(id).forEach((i) => give.run(i.qty, t, i.variant_id));
          if (o.status === 'cancelled') q.items.all(id).forEach((i) => take.run(i.qty, t, i.variant_id));
          db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, t, id);
          db.prepare('INSERT INTO order_events (order_id, at, status, note) VALUES (?, ?, ?, ?)').run(id, t, status, note || '');
        }
        if (adminNote != null) db.prepare('UPDATE orders SET admin_note = ?, updated_at = ? WHERE id = ?').run(adminNote, t, id);
        return orderWithItems(id);
      });
    },
    summary() {
      const month = new Date().toISOString().slice(0, 7);
      const one = (sql, ...a) => db.prepare(sql).get(...a);
      return {
        newOrders: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").n,
        openOrders: one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('new', 'confirmed', 'shipped')").n,
        monthOrders: one("SELECT COUNT(*) AS n FROM orders WHERE substr(created_at, 1, 7) = ? AND status != 'cancelled'", month).n,
        monthSales: one("SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE substr(created_at, 1, 7) = ? AND status != 'cancelled'", month).n,
        newQuotes: one("SELECT COUNT(*) AS n FROM quotes WHERE status = 'new'").n,
        lowStock: db.prepare('SELECT * FROM variants WHERE active = 1 AND stock <= 10 ORDER BY stock, sl').all().map(variantRow),
      };
    },

    // ---------- Online payment ----------
    // A new payment attempt gets a fresh transaction id; only that id can mark the order paid.
    startPayment(id, tranId) {
      db.prepare("UPDATE orders SET tran_id = ?, payment_status = 'pending', payment = 'Online payment', updated_at = ? WHERE id = ? AND payment_status != 'paid'").run(tranId, now(), id);
      return orderWithItems(id);
    },
    orderByTran(tranId) {
      const r = tranId ? db.prepare('SELECT id FROM orders WHERE tran_id = ?').get(tranId) : null;
      return r ? orderWithItems(r.id) : null;
    },
    // Idempotent: the success redirect and the gateway's IPN can both arrive.
    markPaid(id, { amount, ref, method }) {
      return tx(db, () => {
        const o = q.order.get(id);
        if (!o || o.payment_status === 'paid') return { order: orderWithItems(id), changed: false };
        const t = now();
        db.prepare("UPDATE orders SET payment_status = 'paid', paid_at = ?, paid_amount = ?, payment_ref = ?, updated_at = ? WHERE id = ?").run(t, amount, ref, t, id);
        db.prepare('INSERT INTO order_events (order_id, at, status, note) VALUES (?, ?, ?, ?)').run(id, t, o.status, `Paid online${method ? ` by ${method}` : ''}`);
        return { order: orderWithItems(id), changed: true };
      });
    },
    markPaymentFailed(id) {
      db.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND payment_status = 'pending'").run(now(), id);
      return orderWithItems(id);
    },
    switchToCash(id) {
      db.prepare("UPDATE orders SET payment = 'Cash on delivery', payment_status = 'cod', tran_id = '', updated_at = ? WHERE id = ? AND payment_status IN ('pending', 'failed')").run(now(), id);
      return orderWithItems(id);
    },
    // Online orders that were never paid are cancelled after a while so their chairs go back on sale.
    expireUnpaid(hours) {
      const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
      const ids = db.prepare("SELECT id FROM orders WHERE status = 'new' AND payment_status IN ('pending', 'failed') AND updated_at < ?").all(cutoff).map((r) => r.id);
      ids.forEach((id) => this.updateOrder(id, { status: 'cancelled', note: 'Online payment was not completed' }));
      return ids;
    },

    // ---------- Settings ----------
    setting(key, fallback) {
      const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    setSetting: (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)),

    // ---------- Quotes ----------
    addQuote(qt) {
      const r = db.prepare('INSERT INTO quotes (created_at, company, name, phone, email, items, city, needed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(now(), qt.company, qt.name, qt.phone, qt.email, qt.items, qt.city, qt.neededBy);
      return db.prepare('SELECT * FROM quotes WHERE id = ?').get(Number(r.lastInsertRowid));
    },
    quotes: () => db.prepare('SELECT * FROM quotes ORDER BY created_at DESC LIMIT 300').all(),
    updateQuote(id, status) {
      const r = db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run(status, id);
      if (!r.changes) throw new HttpError(404, 'No such quote.');
      return db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
    },

    // ---------- Admins and sessions ----------
    adminCount: () => db.prepare('SELECT COUNT(*) AS n FROM admins').get().n,
    addAdmin: (username, passHash) => db.prepare('INSERT INTO admins (username, pass_hash) VALUES (?, ?)').run(username, passHash),
    adminByName: (username) => db.prepare('SELECT * FROM admins WHERE username = ?').get(username),
    adminById: (id) => db.prepare('SELECT * FROM admins WHERE id = ?').get(id),
    setPassword: (id, passHash) => db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(passHash, id),
    addSession: (tokenHash, adminId, expiresAt) => db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, adminId, expiresAt),
    session: (tokenHash) => db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now()),
    dropSession: (tokenHash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash),
    dropSessionsFor: (adminId) => db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId),
    pruneSessions: () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()),
  };
}
