// Decoture admin panel: orders, products and stock, office quotes, settings.
// Talks to /api/admin/* with the session cookie set at login.
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null ? '—' : '৳' + Math.round(n).toLocaleString('en-IN'));
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' });
  const STATUS = { new: 'New', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
  const QSTATUS = { new: 'New', contacted: 'Contacted', closed: 'Closed' };
  const PAY = { cod: 'Cash on delivery', pending: 'Waiting for payment', paid: 'Paid online', failed: 'Payment failed' };
  const payPill = (o) => (o.paymentStatus && o.paymentStatus !== 'cod' ? ` <span class="pill pill--pay-${esc(o.paymentStatus)}">${PAY[o.paymentStatus]}</span>` : '');
  const main = $('[data-main]');
  const panel = $('[data-panel]');
  const backdrop = $('[data-panel-backdrop]');

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error(data.error || 'Please log in again.'); }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('[data-toast]');
    t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
  }

  // ---------- Login ----------
  function showLogin() {
    $('[data-view="app"]').hidden = true;
    $('[data-view="login"]').hidden = false;
    closePanel();
    $('[data-login-form] input').focus();
  }
  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const err = $('[data-login-error]');
    err.textContent = '';
    try {
      const me = await api('/api/admin/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      f.password.value = '';
      start(me.username);
    } catch (ex) { err.textContent = ex.message; }
  });
  $('[data-logout]').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  function start(username) {
    $('[data-view="login"]').hidden = true;
    $('[data-view="app"]').hidden = false;
    $('[data-whoami]').textContent = `(${username})`;
    route();
  }

  // ---------- Routing ----------
  const VIEWS = { overview, orders, products, quotes, settings };
  function route() {
    const [tab, arg] = (location.hash.slice(1) || 'overview').split('/');
    const view = VIEWS[tab] ? tab : 'overview';
    $$('[data-tab]').forEach((a) => { if (a.dataset.tab === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    VIEWS[view](arg).catch((e) => { if (e.status) main.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
    refreshBadges();
  }
  window.addEventListener('hashchange', route);

  async function refreshBadges() {
    try {
      const s = await api('/api/admin/summary');
      const set = (k, n) => { const b = $(`[data-badge="${k}"]`); b.hidden = !n; b.textContent = n; };
      set('orders', s.newOrders); set('quotes', s.newQuotes);
    } catch { /* shown elsewhere */ }
  }

  // ---------- Overview ----------
  async function overview() {
    const [s, { orders: recent }] = await Promise.all([api('/api/admin/summary'), api('/api/admin/orders')]);
    main.innerHTML = `
      <div class="head"><h1>Overview</h1><a class="btn btn--ghost btn--small" href="#orders">All orders</a></div>
      <div class="stats">
        <a class="stat" href="#orders/new" style="text-decoration:none"><b class="tnum">${s.newOrders}</b><span>New orders to confirm</span></a>
        <div class="stat"><b class="tnum">${s.openOrders}</b><span>Open orders</span></div>
        <div class="stat"><b class="tnum">${s.monthOrders}</b><span>Orders this month</span></div>
        <div class="stat"><b class="tnum">${money(s.monthSales)}</b><span>Sales this month</span></div>
      </div>
      <div class="grid-2">
        <section class="card"><h2>Latest orders</h2>${ordersTable(recent.slice(0, 6), true)}</section>
        <section class="card"><h2>Low stock (10 or fewer)</h2>${s.lowStock.length ? `
          <div class="table-wrap"><table><thead><tr><th>Chair</th><th class="num">Stock</th></tr></thead><tbody>
          ${s.lowStock.map((v) => `<tr class="is-click" data-goto="products/${esc(v.id)}"><td><i class="swatch" style="--c:${esc(v.swatch)}"></i>${esc(v.model)} ${esc(v.colour)}</td><td class="num ${v.stock <= 0 ? 'stock-out' : 'stock-low'}">${v.stock}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="soft">Everything is well stocked.</p>'}
        </section>
      </div>`;
    bindOrderRows(main);
    $$('[data-goto]', main).forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.goto; }));
  }

  // ---------- Orders ----------
  function ordersTable(list, compact = false) {
    if (!list.length) return '<p class="empty">No orders here yet.</p>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Placed</th><th>Customer</th>${compact ? '' : '<th>Phone</th><th>District</th>'}<th class="num">Items</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${list.map((o) => `
        <tr class="is-click" data-order="${esc(o.id)}" tabindex="0">
          <td class="tnum">${esc(o.id)}</td><td>${when(o.createdAt)}</td><td>${esc(o.name)}</td>
          ${compact ? '' : `<td class="tnum">${esc(o.phone)}</td><td>${esc(o.district)}</td>`}
          <td class="num">${o.items.reduce((n, i) => n + i.qty, 0)}</td>
          <td class="num">${money(o.total)}${o.unpriced ? ' +' : ''}</td>
          <td><span class="pill pill--${esc(o.status)}">${STATUS[o.status]}</span>${payPill(o)}</td>
        </tr>`).join('')}</tbody></table></div>`;
  }
  function bindOrderRows(root) {
    $$('[data-order]', root).forEach((tr) => {
      const open = () => openOrder(tr.dataset.order);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  async function orders(filter) {
    const status = STATUS[filter] ? filter : '';
    const { orders: list } = await api(`/api/admin/orders${status ? `?status=${status}` : ''}`);
    main.innerHTML = `
      <div class="head"><h1>Orders</h1><a class="btn btn--ghost btn--small" href="/api/admin/orders.csv">Download CSV</a></div>
      <div class="chips" role="group" aria-label="Filter by status">
        <button class="chip" type="button" data-filter="" aria-pressed="${!status}">All</button>
        ${Object.entries(STATUS).map(([k, v]) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${status === k}">${v}</button>`).join('')}
      </div>
      ${ordersTable(list)}`;
    $$('[data-filter]', main).forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.filter ? `orders/${b.dataset.filter}` : 'orders'; }));
    bindOrderRows(main);
  }

  function openPanel(html) {
    panel.innerHTML = `<button class="btn btn--ghost btn--small panel-close" type="button" data-close>Close</button>${html}`;
    panel.hidden = false; backdrop.hidden = false;
    $('[data-close]', panel).addEventListener('click', closePanel);
    $('[data-close]', panel).focus();
  }
  function closePanel() { panel.hidden = true; backdrop.hidden = true; panel.innerHTML = ''; }
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

  async function openOrder(id) {
    const { order: o } = await api(`/api/admin/orders/${encodeURIComponent(id)}`);
    const wa = `https://wa.me/88${o.phone}?text=${encodeURIComponent(`Hello ${o.name}, this is Decoture about your order ${o.id}.`)}`;
    openPanel(`
      <h2 id="panel-title">Order ${esc(o.id)}</h2>
      <p><span class="pill pill--${esc(o.status)}">${STATUS[o.status]}</span>${payPill(o)} <span class="soft">placed ${when(o.createdAt)}</span></p>
      <section>
        <h3>Customer</h3>
        <p>${esc(o.name)}<br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.email ? `<br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : ''}</p>
        <p>${esc(o.address)}, ${esc(o.area)}, ${esc(o.district)}</p>
        ${o.note ? `<p class="soft">Customer note: ${esc(o.note)}</p>` : ''}
        <div class="actions"><a class="btn btn--small" href="tel:${esc(o.phone)}">Call</a><a class="btn btn--ghost btn--small" href="${wa}" target="_blank" rel="noopener">WhatsApp</a></div>
      </section>
      <section>
        <h3>Chairs</h3>
        ${o.items.map((i) => `<div class="row"><span>${i.qty} × ${esc(i.sku)}</span><span class="tnum">${i.price == null ? 'Price on request' : money(i.price * i.qty)}</span></div>`).join('')}
        <div class="row"><span>Subtotal</span><span class="tnum">${money(o.subtotal)}${o.unpriced ? ' + unpriced items' : ''}</span></div>
        <div class="row"><span>Delivery <span class="soft">${esc(o.delivery)}</span></span><span class="tnum">${o.deliveryFee ? money(o.deliveryFee) : 'Free'}</span></div>
        <div class="row"><strong>Total</strong><strong class="tnum">${money(o.total)}${o.unpriced ? ' +' : ''}</strong></div>
      </section>
      <section>
        <h3>Payment</h3>
        <p>${esc(o.payment)}: <strong>${PAY[o.paymentStatus] || esc(o.paymentStatus)}</strong>${o.paymentStatus === 'paid' ? ` · ${money(o.paidAmount)} on ${when(o.paidAt)}` : ''}</p>
        ${o.paymentRef ? `<p class="soft">SSLCommerz reference: <span class="tnum">${esc(o.paymentRef)}</span></p>` : ''}
        ${o.paymentStatus === 'pending' || o.paymentStatus === 'failed' ? '<p class="soft">The customer has not paid yet. Unpaid online orders are cancelled after 24 hours and the chairs go back in stock. If they call to pay in cash, they can switch on their tracking page.</p>' : ''}
      </section>
      <form data-order-form class="form-grid">
        <label>Status
          <select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === o.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
        </label>
        <label class="full">Message for the customer <span class="soft">(shown on their tracking page; emailed if they gave an email)</span>
          <input name="note" maxlength="300" placeholder="e.g. Delivery booked for Thursday, 3 pm">
        </label>
        <label class="full">Internal note <span class="soft">(only the team sees this)</span>
          <textarea name="adminNote" maxlength="2000">${esc(o.adminNote)}</textarea>
        </label>
        <p class="error full" data-order-error role="alert"></p>
        <div class="actions full"><button class="btn" type="submit">Save</button>${o.status === 'cancelled' ? '' : `<span class="soft">Cancelling puts the chairs back in stock.${o.paymentStatus === 'paid' ? ' This order is paid: refund it in the SSLCommerz merchant panel.' : ''}</span>`}</div>
      </form>
      <section>
        <h3>History</h3>
        <ol class="history">${o.events.map((e) => `<li><span><span class="pill pill--${esc(e.status)}">${STATUS[e.status]}</span> <span class="soft">${when(e.at)}</span></span>${e.note ? `<span>${esc(e.note)}</span>` : ''}</li>`).join('')}</ol>
      </section>`);
    $('[data-order-form]', panel).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await api(`/api/admin/orders/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: { status: f.status.value, note: f.note.value, adminNote: f.adminNote.value } });
        toast(`Order ${o.id} saved`);
        closePanel();
        route();
      } catch (ex) { $('[data-order-error]', panel).textContent = ex.message; }
    });
  }

  // ---------- Products ----------
  let productState = { q: '', collection: '' };
  async function products(focusId) {
    const { variants, collections } = await api('/api/admin/variants');
    main.innerHTML = `
      <div class="head"><h1>Products &amp; stock</h1><button class="btn btn--small" type="button" data-add-variant>Add a colourway</button></div>
      <div class="tools">
        <input type="search" placeholder="Search model or colour" value="${esc(productState.q)}" data-search aria-label="Search products">
        <select data-collection aria-label="Collection"><option value="">All collections</option>${Object.entries(collections).map(([k, v]) => `<option value="${k}"${productState.collection === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <span class="soft" data-count></span>
      </div>
      <p class="soft">Change a price, sale price or stock and press Save on that row. Leave the sale price empty for no sale. Untick "On sale" to hide a chair from the store. Click a photo to replace it.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Chair</th><th>Collection</th><th class="num">Price ৳</th><th class="num">Sale ৳</th><th class="num">Stock</th><th>On sale</th><th></th></tr></thead>
        <tbody data-rows>${variants.map((v) => `
          <tr data-id="${esc(v.id)}" class="${v.active ? '' : 'is-off'}" data-search-text="${esc(`${v.model} ${v.colour}`.toLowerCase())}" data-coll="${esc(v.collection)}">
            <td><button class="prod-thumb" type="button" data-photo aria-label="Replace photo of ${esc(v.model)} ${esc(v.colour)}">${v.image ? `<img src="/${esc(v.image)}" alt="" loading="lazy">` : ''}<span>Photo</span></button></td>
            <td><i class="swatch" style="--c:${esc(v.swatch)}"></i>${esc(v.model)} <span class="soft">${esc(v.colour)}</span></td>
            <td class="soft">${esc(collections[v.collection] || v.collection)}</td>
            <td class="num"><input class="cell-input" name="price" inputmode="numeric" value="${v.price ?? ''}" aria-label="Price"></td>
            <td class="num"><input class="cell-input" name="salePrice" inputmode="numeric" value="${v.salePrice ?? ''}" aria-label="Sale price"></td>
            <td class="num"><input class="cell-input ${v.stock <= 0 ? 'stock-out' : v.stock <= 10 ? 'stock-low' : ''}" name="stock" inputmode="numeric" value="${v.stock}" aria-label="Stock"></td>
            <td><input type="checkbox" name="active" ${v.active ? 'checked' : ''} aria-label="On sale" style="width:auto;min-height:0"></td>
            <td><button class="btn btn--small" type="button" data-save disabled>Save</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-file hidden>`;

    const rows = $$('[data-id]', main);
    const filter = () => {
      const q = productState.q.trim().toLowerCase();
      let n = 0;
      rows.forEach((tr) => {
        const show = (!q || tr.dataset.searchText.includes(q)) && (!productState.collection || tr.dataset.coll === productState.collection);
        tr.hidden = !show; if (show) n += 1;
      });
      $('[data-count]', main).textContent = `${n} colourways`;
    };
    $('[data-search]', main).addEventListener('input', (e) => { productState.q = e.target.value; filter(); });
    $('[data-collection]', main).addEventListener('change', (e) => { productState.collection = e.target.value; filter(); });
    filter();

    rows.forEach((tr) => {
      const save = $('[data-save]', tr);
      $$('input', tr).forEach((inp) => inp.addEventListener('input', () => { tr.classList.add('is-dirty'); save.disabled = false; }));
      $$('.cell-input', tr).forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); }));
      save.addEventListener('click', async () => {
        const val = (n) => { const s = $(`[name="${n}"]`, tr).value.trim().replace(/,/g, ''); return s === '' ? null : Number(s); };
        save.disabled = true;
        try {
          const { variant } = await api(`/api/admin/variants/${tr.dataset.id}`, {
            method: 'PATCH',
            body: { price: val('price'), salePrice: val('salePrice'), stock: val('stock') ?? 0, active: $('[name="active"]', tr).checked },
          });
          tr.classList.remove('is-dirty');
          tr.classList.toggle('is-off', !variant.active);
          const stockInput = $('[name="stock"]', tr);
          stockInput.classList.toggle('stock-out', variant.stock <= 0);
          stockInput.classList.toggle('stock-low', variant.stock > 0 && variant.stock <= 10);
          toast(`${variant.model} ${variant.colour} saved. The store shows it now.`);
        } catch (ex) { save.disabled = false; toast(ex.message); }
      });
    });

    // Photo upload: resized in the browser to at most 1600px, then sent as a JPEG.
    const file = $('[data-file]', main);
    let photoRow = null;
    $$('[data-photo]', main).forEach((b) => b.addEventListener('click', () => { photoRow = b.closest('tr'); file.value = ''; file.click(); }));
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f || !photoRow) return;
      try {
        const dataUrl = await resizeImage(f, 1600);
        const { variant } = await api(`/api/admin/variants/${photoRow.dataset.id}/image`, { method: 'POST', body: { dataUrl } });
        $('[data-photo]', photoRow).innerHTML = `<img src="/${esc(variant.image)}" alt=""><span>Photo</span>`;
        toast(`New photo for ${variant.model} ${variant.colour}`);
      } catch (ex) { toast(ex.message); }
    });

    $('[data-add-variant]', main).addEventListener('click', () => addVariant(collections));
    if (focusId) {
      const tr = rows.find((r) => r.dataset.id === focusId);
      if (tr) { tr.scrollIntoView({ block: 'center' }); $('[name="stock"]', tr).focus(); }
    }
  }

  function resizeImage(fileObj, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileObj);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a photo.')); };
      img.src = url;
    });
  }

  function addVariant(collections) {
    openPanel(`
      <h2 id="panel-title">Add a colourway</h2>
      <p class="soft">Use an existing model name to add a colour to it, or a new name for a new chair. You can add the photo from the table afterwards.</p>
      <form class="form-grid" data-add-form novalidate>
        <label>Model<input name="model" required placeholder="e.g. 6859A"></label>
        <label>Colour<input name="colour" required placeholder="e.g. Black"></label>
        <label>Collection<select name="collection">${Object.entries(collections).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label>Swatch colour<input name="swatch" type="color" value="#1d1d1f" style="padding:2px"></label>
        <label>Price ৳<input name="price" inputmode="numeric" placeholder="e.g. 9500"></label>
        <label>Sale price ৳ <span class="soft">(optional)</span><input name="salePrice" inputmode="numeric"></label>
        <label>Stock<input name="stock" inputmode="numeric" value="0"></label>
        <label>Warranty (years)<input name="warrantyYears" inputmode="numeric" value="2"></label>
        <p class="error full" data-add-error role="alert"></p>
        <div class="actions full"><button class="btn" type="submit">Add to the store</button></div>
      </form>`);
    $('[data-add-form]', panel).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const n = (name) => (f[name].value.trim() === '' ? null : Number(f[name].value.trim().replace(/,/g, '')));
      try {
        const { variant } = await api('/api/admin/variants', {
          method: 'POST',
          body: { model: f.model.value, colour: f.colour.value, collection: f.collection.value, swatch: f.swatch.value, price: n('price'), salePrice: n('salePrice'), stock: n('stock') ?? 0, warrantyYears: n('warrantyYears') },
        });
        closePanel();
        toast(`${variant.model} ${variant.colour} added`);
        location.hash = `products/${variant.id}`;
        route();
      } catch (ex) { $('[data-add-error]', panel).textContent = ex.message; }
    });
  }

  // ---------- Quotes ----------
  async function quotes() {
    const { quotes: list } = await api('/api/admin/quotes');
    main.innerHTML = `
      <div class="head"><h1>Office quote requests</h1></div>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Received</th><th>Company / name</th><th>Phone</th><th>Chairs</th><th>City</th><th>Needed by</th><th>Status</th></tr></thead>
        <tbody>${list.map((q) => `
          <tr data-quote="${q.id}">
            <td>${when(q.created_at)}</td>
            <td>${q.company ? `${esc(q.company)}<br>` : ''}<span class="soft">${esc(q.name)}</span>${q.email ? `<br><a href="mailto:${esc(q.email)}">${esc(q.email)}</a>` : ''}</td>
            <td><a href="tel:${esc(q.phone)}">${esc(q.phone)}</a></td>
            <td class="wrap">${esc(q.items) || '<span class="soft">—</span>'}</td>
            <td>${esc(q.city) || '—'}</td>
            <td>${esc(q.needed_by) || '—'}</td>
            <td><select data-qstatus aria-label="Status" style="width:auto">${Object.entries(QSTATUS).map(([k, v]) => `<option value="${k}"${k === q.status ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No quote requests yet. They arrive from the "For offices" page and the home page.</p>'}`;
    $$('[data-qstatus]', main).forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api(`/api/admin/quotes/${sel.closest('tr').dataset.quote}`, { method: 'PATCH', body: { status: sel.value } });
        toast('Quote updated'); refreshBadges();
      } catch (ex) { toast(ex.message); }
    }));
  }

  // ---------- Settings ----------
  async function settings() {
    const cfg = await api('/api/admin/settings');
    const d = cfg.delivery;
    const zoneRow = (z, i) => {
      const last = i === d.zones.length - 1;
      return `
      <fieldset class="zone" data-zone="${i}">
        <legend>${esc(z.name)}</legend>
        <div class="form-grid">
          <label>Name<input name="name" value="${esc(z.name)}" maxlength="40" required></label>
          <label>Delivery time<input name="days" value="${esc(z.days)}" maxlength="40" placeholder="e.g. 1 to 2 days"></label>
          <label>Charge for the first chair (৳)<input name="fee" type="number" min="0" step="1" value="${z.fee}" required></label>
          <label>Each extra chair (৳)<input name="extra" type="number" min="0" step="1" value="${z.extra}" required></label>
          ${last
            ? '<p class="soft full">Covers every district not listed in the zones above.</p>'
            : `<label class="full">Districts <span class="soft">(separate with commas)</span><textarea name="districts" rows="2">${esc(z.districts.join(', '))}</textarea></label>`}
        </div>
      </fieldset>`;
    };
    main.innerHTML = `
      <div class="head"><h1>Settings</h1></div>
      <section class="card" style="max-width:720px">
        <h2>Delivery charges</h2>
        <p class="soft">Customers see the charge for their district at checkout, and it is added to the order total. An order with more than one chair pays the first-chair charge once, plus the extra-chair charge for each additional chair.</p>
        <form data-delivery-form novalidate>
          ${d.zones.map(zoneRow).join('')}
          <div class="form-grid">
            <label>Free delivery for orders from (৳) <span class="soft">(leave empty for never)</span><input name="freeOver" type="number" min="0" step="1" value="${d.freeOver ?? ''}"></label>
          </div>
          <p class="error" data-delivery-error role="alert"></p>
          <div class="actions"><button class="btn" type="submit">Save delivery charges</button></div>
        </form>
      </section>
      <section class="card" style="max-width:720px">
        <h2>Online payment</h2>
        <p class="soft">${cfg.payments.online
          ? `SSLCommerz is connected in <strong>${cfg.payments.mode === 'live' ? 'live mode: real payments' : 'sandbox mode: test payments only'}</strong>. Customers can pay with bKash, Nagad, Rocket or a card at checkout.`
          : 'Online payment is off. Customers pay cash on delivery. To turn it on, add your SSLCommerz store ID and password to the server settings (see the README).'}</p>
      </section>
      <section class="card" style="max-width:720px">
        <h2>Change password</h2>
        <form class="form-grid" data-pass-form novalidate>
          <label class="full">Current password<input name="current" type="password" autocomplete="current-password" required></label>
          <label class="full">New password <span class="soft">(at least 10 characters)</span><input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
          <p class="error full" data-pass-error role="alert"></p>
          <div class="actions full"><button class="btn" type="submit">Change password</button></div>
        </form>
      </section>
      <section class="card" style="max-width:720px">
        <h2>Order emails</h2>
        <p class="soft">${cfg.email ? 'Email is on.' : 'Email is off.'} New orders and quote requests are emailed to the shop when the server has SMTP settings (see the README). Customers who give an email get a confirmation and status updates.</p>
      </section>`;
    $('[data-delivery-form]', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const out = $('[data-delivery-error]', main);
      const zones = $$('[data-zone]', f).map((fs) => ({
        name: fs.querySelector('[name=name]').value,
        days: fs.querySelector('[name=days]').value,
        fee: fs.querySelector('[name=fee]').value === '' ? null : Number(fs.querySelector('[name=fee]').value),
        extra: fs.querySelector('[name=extra]').value === '' ? null : Number(fs.querySelector('[name=extra]').value),
        districts: fs.querySelector('[name=districts]') ? fs.querySelector('[name=districts]').value.split(',').map((x) => x.trim()).filter(Boolean)
          .map((x) => cfg.districts.find((n) => n.toLowerCase() === x.toLowerCase()) || x) : [],
      }));
      try {
        await api('/api/admin/settings/delivery', { method: 'PUT', body: { zones, freeOver: f.freeOver.value === '' ? null : Number(f.freeOver.value) } });
        out.textContent = '';
        toast('Delivery charges saved');
        settings();
      } catch (ex) { out.textContent = ex.message; }
    });
    $('[data-pass-form]', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      try {
        await api('/api/admin/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
        f.reset(); $('[data-pass-error]', main).textContent = '';
        toast('Password changed. Other devices have been logged out.');
      } catch (ex) { $('[data-pass-error]', main).textContent = ex.message; }
    });
  }

  // ---------- Boot ----------
  api('/api/admin/me').then((me) => start(me.username)).catch(() => showLogin());
})();
