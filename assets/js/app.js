// Shared storefront code: config, catalog helpers, cart, header, footer and cart drawer.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  const CONFIG = {
    phone: '+880 1791 978775',
    phoneHref: 'tel:+8801791978775',
    whatsapp: '8801791978775',
    email: 'hellow@decoture.com',
    address: ['57/60, Uttar Senpara Parbata 11', 'Mirpur Model Police Station', 'Dhaka 1216, Bangladesh'],
    lowStock: 10,
    currency: '৳',
  };

  const catalog = window.DECOTURE_CATALOG;
  const products = catalog.products;
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const byVariant = new Map();
  products.forEach((p) => p.variants.forEach((v) => byVariant.set(v.id, { product: p, variant: v })));

  // ---------- Formatting ----------
  const money = (n) => (n == null ? null : CONFIG.currency + Math.round(n).toLocaleString('en-IN'));
  const variantPrice = (v) => (v.salePrice != null ? v.salePrice : v.price);
  const priceLabel = (v) => money(variantPrice(v)) ?? 'Price on request';
  const productFromPrice = (p) => {
    const prices = p.variants.map(variantPrice).filter((n) => n != null);
    return prices.length ? Math.min(...prices) : null;
  };
  const stockState = (v) => {
    if (v.stock <= 0) return { key: 'out', label: 'Out of stock' };
    if (v.stock <= CONFIG.lowStock) return { key: 'low', label: `Only ${v.stock} left` };
    if (v.stock >= 100) return { key: 'in', label: '100+ in stock' };
    return { key: 'in', label: 'In stock' };
  };
  const productStock = (p) => p.variants.reduce((n, v) => n + Math.max(0, v.stock), 0);
  const firstImage = (p) => (p.variants.find((v) => v.image) || {}).image || null;
  const FAMILIES = [
    { key: 'black', label: 'Black', hex: '#1d1d1f', match: ['black', 'full black', 'iron'] },
    { key: 'grey', label: 'Grey', hex: '#8f9396', match: ['grey', 'ash', 'silver', 'full mesh'] },
    { key: 'white', label: 'White & peach', hex: '#efe6da', match: ['white', 'pearl white', 'falk white', 'peach'] },
    { key: 'brown', label: 'Sand & brown', hex: '#b9875a', match: ['sand', 'bronze', 'brown', 'khaki'] },
    { key: 'green', label: 'Green', hex: '#2f6b55', match: ['green', 'black / green seat'] },
    { key: 'red', label: 'Red & orange', hex: '#b5452f', match: ['red', 'orange'] },
    { key: 'blue', label: 'Blue', hex: '#2f5d8a', match: ['blue', 'grey / blue'] },
  ];
  const familyOf = (v) => (FAMILIES.find((f) => f.match.includes(v.colour.toLowerCase())) || {}).key || null;
  const productUrl = (p, v) => `product.html?m=${encodeURIComponent(p.slug)}${v ? '&c=' + encodeURIComponent(v.id) : ''}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PLACEHOLDER = 'assets/img/logo/mark.svg';

  // ---------- Storage (guarded: private windows can throw) ----------
  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ }
    },
  };

  // ---------- Cart ----------
  const CART_KEY = 'decoture.cart.v1';
  const listeners = new Set();
  let items = storage.get(CART_KEY, []).filter((i) => byVariant.has(i.id));

  const cart = {
    items: () => items.map((i) => ({ ...i, ...byVariant.get(i.id) })),
    count: () => items.reduce((n, i) => n + i.qty, 0),
    add(id, qty = 1) {
      const entry = byVariant.get(id);
      if (!entry || entry.variant.stock <= 0) return false;
      const max = entry.variant.stock;
      const found = items.find((i) => i.id === id);
      if (found) found.qty = Math.min(max, found.qty + qty);
      else items.push({ id, qty: Math.min(max, qty) });
      save();
      return true;
    },
    setQty(id, qty) {
      const entry = byVariant.get(id);
      const found = items.find((i) => i.id === id);
      if (!found || !entry) return;
      found.qty = Math.max(1, Math.min(entry.variant.stock, qty | 0));
      save();
    },
    remove(id) { items = items.filter((i) => i.id !== id); save(); },
    clear() { items = []; save(); },
    totals() {
      let subtotal = 0; let unpriced = 0;
      cart.items().forEach((i) => {
        const p = variantPrice(i.variant);
        if (p == null) unpriced += i.qty; else subtotal += p * i.qty;
      });
      return { subtotal, unpriced, count: cart.count() };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  function save() { storage.set(CART_KEY, items); listeners.forEach((fn) => fn()); }
  window.addEventListener('storage', (e) => {
    if (e.key === CART_KEY) { items = storage.get(CART_KEY, []).filter((i) => byVariant.has(i.id)); listeners.forEach((fn) => fn()); }
  });

  // ---------- Shared markup ----------
  const page = document.body.dataset.page || '';
  const NAV = [
    ['shop', 'shop.html', 'Shop chairs'],
    ['offices', 'offices.html', 'For offices'],
    ['about', 'about.html', 'About'],
    ['contact', 'contact.html', 'Showroom & contact'],
  ];

  function renderHeader() {
    const el = document.querySelector('[data-site-header]');
    if (!el) return;
    el.className = 'site-header';
    el.innerHTML = `
      <a class="brand" href="index.html" aria-label="Decoture home">
        <img class="brand-mark" src="assets/img/logo/mark.svg" alt="" width="33" height="22">
        <img src="assets/img/logo/wordmark.svg" alt="decoture" width="133" height="26">
      </a>
      <nav class="nav" id="site-nav" aria-label="Main">
        ${NAV.map(([key, href, label]) => `<a href="${href}"${key === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <div class="header-actions">
        <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
        <button class="cart-button" type="button" data-open-cart aria-label="Open cart">
          <span class="cart-label">Cart</span><span class="cart-count tnum" data-cart-count>0</span>
        </button>
      </div>`;
    const menu = el.querySelector('.menu-button');
    const nav = el.querySelector('.nav');
    menu.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      menu.setAttribute('aria-expanded', String(open));
      menu.textContent = open ? 'Close' : 'Menu';
    });
  }

  function renderFooter() {
    const el = document.querySelector('[data-site-footer]');
    if (!el) return;
    el.className = 'site-footer';
    el.innerHTML = `
      <div class="tile tile-statement">
        <p>Imported chairs, chosen for the way Dhaka works and lives.</p>
        <p>© ${new Date().getFullYear()} Decoture. Prices in BDT. Stock list updated ${formatDate(catalog.stockListDate)}.</p>
      </div>
      <nav class="tile tile-nav" aria-label="Footer">
        <ul>
          <li><a href="shop.html">All chairs</a></li>
          ${Object.entries(catalog.collections).map(([k, c]) => `<li><a href="shop.html?collection=${k}">${esc(c.name)}</a></li>`).join('')}
          <li><a href="offices.html">For offices</a></li>
          <li><a href="about.html">About Decoture</a></li>
          <li><a href="cart.html">Cart</a></li>
        </ul>
      </nav>
      <div class="tile tile-place">
        <p>Mirpur, Dhaka</p>
        <p class="clock" data-clock>--:--</p>
        <p class="soft">${CONFIG.address.slice(0, 1).join('')}</p>
      </div>
      <div class="tile tile-email">
        <p class="soft">Write or call</p>
        <a href="mailto:${CONFIG.email}">${CONFIG.email}</a>
        <a href="${CONFIG.phoneHref}">${CONFIG.phone}</a>
      </div>
      <div class="tile tile-word"><img src="assets/img/logo/lockup.svg" alt="decoture, style, comfort, crafted" width="522" height="280" loading="lazy"></div>
      <a class="tile tile-cta" href="shop.html">
        <span>Find your chair</span>
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="4" aria-hidden="true"><path d="M14 42 42 14M20 14h22v22"/></svg>
      </a>`;
    const clock = el.querySelector('[data-clock]');
    const tick = () => {
      try {
        clock.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }).format(new Date());
      } catch { clock.textContent = ''; }
    };
    tick(); setInterval(tick, 30000);
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---------- Cart drawer ----------
  let lastFocus = null;
  function renderDrawer() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="drawer-backdrop" data-close-cart></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1">
        <div class="drawer-head">
          <h2 id="drawer-title">Your cart</h2>
          <button class="icon-button" type="button" data-close-cart>Close</button>
        </div>
        <div class="drawer-body" data-drawer-body></div>
        <div class="drawer-foot" data-drawer-foot></div>
      </aside>`;
    document.body.append(...wrap.children);
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-cart]')) { e.preventDefault(); openDrawer(); }
      if (e.target.closest('[data-close-cart]')) closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) closeDrawer();
      if (e.key === 'Tab' && document.body.classList.contains('drawer-open')) trapFocus(e);
    });
    bindLineItems(document.querySelector('[data-drawer-body]'));
  }
  function trapFocus(e) {
    const drawer = document.querySelector('.drawer');
    const f = drawer.querySelectorAll('a[href], button:not([disabled]), input');
    if (!f.length) return;
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openDrawer() {
    if (page === 'cart') { document.querySelector('main')?.focus(); return; }
    lastFocus = document.activeElement;
    clearTimeout(unmountTimer);
    document.body.classList.add('drawer-mounted');
    void document.body.offsetWidth; // let the closed state paint before animating in
    document.body.classList.add('drawer-open');
    setTimeout(() => document.querySelector('.drawer')?.focus(), 30);
  }
  let unmountTimer;
  function closeDrawer() {
    document.body.classList.remove('drawer-open');
    unmountTimer = setTimeout(() => document.body.classList.remove('drawer-mounted'), 360);
    lastFocus?.focus?.();
  }

  function lineItemsHTML() {
    return cart.items().map((i) => {
      const p = variantPrice(i.variant);
      return `
      <div class="line-item" data-line="${i.id}">
        <a class="thumb" href="${productUrl(i.product, i.variant)}" tabindex="-1" aria-hidden="true">
          <img src="${i.variant.image || PLACEHOLDER}" alt="" loading="lazy">
        </a>
        <div>
          <h3><a href="${productUrl(i.product, i.variant)}">${esc(i.product.name)}</a></h3>
          <p class="meta">${esc(i.variant.colour)} · ${priceLabel(i.variant)}</p>
          <div class="controls">
            <div class="qty" role="group" aria-label="Quantity for ${esc(i.variant.sku)}">
              <button type="button" data-dec aria-label="Decrease">−</button>
              <input type="number" inputmode="numeric" min="1" max="${i.variant.stock}" value="${i.qty}" aria-label="Quantity">
              <button type="button" data-inc aria-label="Increase">+</button>
            </div>
            <button type="button" class="remove" data-remove>Remove</button>
          </div>
        </div>
        <div class="line-total">${p == null ? '' : money(p * i.qty)}</div>
      </div>`;
    }).join('');
  }
  function totalsHTML() {
    const t = cart.totals();
    return `
      <div class="totals">
        <div><span>Subtotal (${t.count} ${t.count === 1 ? 'chair' : 'chairs'})</span><span>${money(t.subtotal)}</span></div>
        ${t.unpriced ? `<div><span>Priced on confirmation</span><span>${t.unpriced}</span></div>` : ''}
        <div><span>Delivery</span><span class="soft">Confirmed by phone</span></div>
        <div class="grand"><span>Total</span><span>${money(t.subtotal)}${t.unpriced ? ' +' : ''}</span></div>
      </div>`;
  }
  function bindLineItems(root) {
    if (!root) return;
    root.addEventListener('click', (e) => {
      const line = e.target.closest('[data-line]');
      if (!line) return;
      const id = line.dataset.line;
      const input = line.querySelector('input');
      if (e.target.closest('[data-inc]')) cart.setQty(id, +input.value + 1);
      if (e.target.closest('[data-dec]')) cart.setQty(id, +input.value - 1);
      if (e.target.closest('[data-remove]')) cart.remove(id);
    });
    root.addEventListener('change', (e) => {
      const line = e.target.closest('[data-line]');
      if (line && e.target.matches('input')) cart.setQty(line.dataset.line, +e.target.value || 1);
    });
  }
  function updateDrawer() {
    const body = document.querySelector('[data-drawer-body]');
    const foot = document.querySelector('[data-drawer-foot]');
    if (!body) return;
    if (!cart.count()) {
      body.innerHTML = `<div class="drawer-empty"><p>Your cart is empty.</p><a class="button button--ghost" href="shop.html">Browse all chairs</a></div>`;
      foot.innerHTML = '';
      return;
    }
    body.innerHTML = lineItemsHTML();
    foot.innerHTML = `${totalsHTML()}
      <a class="button button--block" href="checkout.html">Checkout · cash on delivery</a>
      <a class="button button--ghost button--block" href="cart.html">View cart</a>`;
  }
  function updateCount() {
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      const n = cart.count();
      if (el.textContent !== String(n)) {
        el.textContent = n;
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      }
    });
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  // ---------- Reveal on scroll ----------
  function reveal(root = document) {
    const els = root.querySelectorAll('[data-reveal]:not(.is-in), .shutter:not(.is-in)');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
    // A fully clipped element never intersects, so shutters are watched through their parent.
    const targets = new Map();
    els.forEach((el) => targets.set(el.classList.contains('shutter') ? el.parentElement : el, el));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        targets.get(en.target)?.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    targets.forEach((_, host) => io.observe(host));
  }

  // ---------- Card markup used by shop, home and related ----------
  function cardHTML(p, i = 0) {
    const img = firstImage(p);
    const from = productFromPrice(p);
    const total = productStock(p);
    const state = total <= 0 ? { key: 'out', label: 'Out of stock' } : total <= CONFIG.lowStock ? { key: 'low', label: `Only ${total} left` } : { key: 'in', label: 'In stock' };
    return `
      <a class="card" href="${productUrl(p)}" data-reveal style="--d:${(i % 6) * 50}ms">
        <span class="frame">
          <img src="${img || PLACEHOLDER}" alt="${esc(p.name)} chair" width="400" height="500" loading="lazy">
          <span class="frame-strip strip-${i % 4}"><span class="model">${esc(p.model)}</span><span>${esc(catalog.collections[p.collection].name)}</span></span>
        </span>
        <span class="card-body">
          <span class="card-title"><strong>${esc(p.name)}</strong><span>${from == null ? 'On request' : money(from)}</span></span>
          <span class="card-meta">
            <span class="card-swatches" aria-label="${p.variants.length} ${p.variants.length === 1 ? 'colour' : 'colours'}">${p.variants.map((v) => `<i style="--c:${v.swatch}" title="${esc(v.colour)}"></i>`).join('')}</span>
            <span class="status status--${state.key}">${state.label}</span>
          </span>
        </span>
      </a>`;
  }

  // ---------- Orders (phase 1: saved in the browser and sent by WhatsApp or email) ----------
  const ORDERS_KEY = 'decoture.orders.v1';
  const orders = {
    all: () => storage.get(ORDERS_KEY, []),
    get: (id) => orders.all().find((o) => o.id === id),
    save(order) { const list = orders.all(); list.unshift(order); storage.set(ORDERS_KEY, list.slice(0, 20)); },
    newId() {
      const d = new Date();
      const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      return `DC-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    },
    message(o) {
      const lines = [
        `New order ${o.id}`,
        '',
        ...o.items.map((i) => `• ${i.qty} × ${i.sku}${i.price != null ? ` @ ${money(i.price)}` : ''}`),
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
      ].filter((l) => l !== null);
      return lines.join('\n');
    },
  };
  // Follow an external link from a submit handler (window.open is blocked in some embedded views).
  const openExternal = (url) => {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
  };
  const whatsappLink = (text) => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
  const mailLink = (subject, body) => `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  // ---------- Boot ----------
  renderHeader();
  renderFooter();
  renderDrawer();
  cart.subscribe(() => { updateCount(); updateDrawer(); });
  updateDrawer();
  document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = cart.count(); });

  window.Decoture = {
    CONFIG, catalog, products, bySlug, byVariant, cart, orders, FAMILIES, familyOf,
    money, priceLabel, variantPrice, productFromPrice, stockState, productStock, firstImage, productUrl, esc,
    cardHTML, lineItemsHTML, totalsHTML, bindLineItems, reveal, toast, openDrawer, openExternal, whatsappLink, mailLink, PLACEHOLDER,
  };
  document.addEventListener('DOMContentLoaded', () => reveal());
})();
