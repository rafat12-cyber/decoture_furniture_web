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
  const VIEWS = { overview, orders, products, stock, quotes, settings };
  function route() {
    const [tab, arg] = (location.hash.slice(1) || 'overview').split('/');
    const view = VIEWS[tab] ? tab : 'overview';
    const navTab = view === 'stock' ? 'products' : view;
    $$('[data-tab]').forEach((a) => { if (a.dataset.tab === navTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
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
          ${s.lowStock.map((v) => `<tr class="is-click" data-goto="stock/${esc(v.id)}"><td><i class="swatch" style="--c:${esc(v.swatch)}"></i>${esc(v.name || v.model)} ${esc(v.colour)}</td><td class="num ${v.stock <= 0 ? 'stock-out' : 'stock-low'}">${v.stock}</td></tr>`).join('')}
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
        <label class="full"><span>Message for the customer <span class="soft">(shown on their tracking page; emailed if they gave an email)</span></span>
          <input name="note" maxlength="300" placeholder="e.g. Delivery booked for Thursday, 3 pm">
        </label>
        <label class="full"><span>Internal note <span class="soft">(only the team sees this)</span></span>
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
  // #products lists every chair; #products/<slug> is the edit page for one chair and all its
  // colours. #stock is the quick table for changing many prices and stock counts at once.
  let productState = { q: '', collection: '' };
  async function products(arg) {
    if (arg) return editProduct(arg);
    const { products: list, collections } = await api('/api/admin/products');
    main.innerHTML = `
      <div class="head"><h1>Products</h1><div class="actions"><a class="btn btn--ghost btn--small" href="#stock">Quick stock edit</a><button class="btn btn--small" type="button" data-add-variant>Add a chair</button></div></div>
      <div class="tools">
        <input type="search" placeholder="Search name or model" value="${esc(productState.q)}" data-search aria-label="Search products">
        <select data-collection aria-label="Category"><option value="">All categories</option>${Object.entries(collections).map(([k, v]) => `<option value="${k}"${productState.collection === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <span class="soft" data-count></span>
      </div>
      <p class="soft">Click a chair to edit its name, details, colours, prices, stock and photos.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Chair</th><th>Category</th><th class="num">Colours</th><th class="num">Stock</th><th class="num">From</th><th></th></tr></thead>
        <tbody>${list.map((p) => `
          <tr class="is-click ${p.onSale ? '' : 'is-off'}" data-goto="products/${esc(p.slug)}" data-search-text="${esc(`${p.name} ${p.model}`.toLowerCase())}" data-coll="${esc(p.collection)}">
            <td><span class="prod-thumb">${p.image ? `<img src="/${esc(p.image)}" alt="" loading="lazy">` : ''}</span></td>
            <td><strong style="font-weight:500">${esc(p.name)}</strong>${p.onSale ? '' : ' <span class="pill">Hidden</span>'}</td>
            <td class="soft">${esc(collections[p.collection] || p.collection)}</td>
            <td class="num">${p.onSale === p.colours ? p.colours : `${p.onSale} of ${p.colours}`}</td>
            <td class="num ${p.stock <= 0 ? 'stock-out' : p.stock <= 10 ? 'stock-low' : ''}">${p.stock}</td>
            <td class="num">${p.from == null ? '<span class="soft">On request</span>' : money(p.from)}</td>
            <td><a class="btn btn--ghost btn--small" href="#products/${esc(p.slug)}">Edit</a></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
    const rows = $$('[data-goto]', main);
    const filter = () => {
      const q = productState.q.trim().toLowerCase();
      let n = 0;
      rows.forEach((tr) => {
        const show = (!q || tr.dataset.searchText.includes(q)) && (!productState.collection || tr.dataset.coll === productState.collection);
        tr.hidden = !show; if (show) n += 1;
      });
      $('[data-count]', main).textContent = `${n} chairs`;
    };
    $('[data-search]', main).addEventListener('input', (e) => { productState.q = e.target.value; filter(); });
    $('[data-collection]', main).addEventListener('change', (e) => { productState.collection = e.target.value; filter(); });
    rows.forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.goto; }));
    filter();
    $('[data-add-variant]', main).addEventListener('click', () => addVariant(collections));
  }

  // ---------- One chair ----------
  async function editProduct(key) {
    let data;
    try { data = await api(`/api/admin/products/${encodeURIComponent(key)}`); } catch (ex) {
      // Older links name a colourway (e.g. from the low-stock list): open its chair.
      if (ex.status === 404) {
        const { variants } = await api('/api/admin/variants');
        const v = variants.find((x) => x.id === key);
        if (v) { location.replace(`#products/${v.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`); return; }
      }
      throw ex;
    }
    const { product: p, collections } = data;
    const d = p.defaults;
    main.innerHTML = `
      <div class="head">
        <div style="display:grid;gap:6px"><a class="soft" href="#products">← All products</a><h1>${esc(p.name)}</h1></div>
        <div class="actions"><a class="btn btn--ghost btn--small" href="/product.html?m=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View in store</a><button class="btn btn--small" type="button" data-add-colour>Add a colour</button></div>
      </div>

      <section class="card">
        <h2>Details</h2>
        <form class="form-grid" data-details novalidate>
          <label><span>Name <span class="soft">(shown with the model number)</span></span><input name="name" maxlength="40" value="${esc(p.details?.name || '')}" placeholder="${esc(d.title || 'No name')}"></label>
          <label>Model number<input value="${esc(p.model)}" disabled></label>
          <label>Category<select name="collection">${Object.entries(collections).map(([k, v]) => `<option value="${k}"${p.collection === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label>Warranty (years)<input name="warrantyYears" inputmode="numeric" value="${p.warrantyYears ?? ''}"></label>
          <label class="full"><span>Features <span class="soft">(one per line, shown under the name)</span></span><textarea name="features" rows="3" placeholder="${esc(d.features.join('\n') || 'e.g. Headrest')}">${esc(p.details?.features?.join('\n') || '')}</textarea></label>
          <label class="full">Description<textarea name="description" rows="4" maxlength="1500" placeholder="${esc(d.description)}">${esc(p.details?.description || '')}</textarea></label>
          <p class="soft full">Leave a field empty to use the standard text shown in grey.</p>
          <p class="error full" data-details-error role="alert"></p>
          <div class="actions full"><button class="btn" type="submit">Save details</button></div>
        </form>
      </section>

      <div class="head"><h2 style="font-size:1.0625rem;font-weight:500">Colours, prices and photos</h2></div>
      ${p.variants.map((v) => `
        <section class="card variant ${v.active ? '' : 'is-off'}" data-variant="${esc(v.id)}">
          <div class="head"><h2><i class="swatch" style="--c:${esc(v.swatch)}"></i>${esc(v.colour)} ${v.code ? `<span class="soft">· ${esc(v.code)}</span>` : ''}</h2>${v.active ? '' : '<span class="pill">Hidden from the store</span>'}</div>
          <form class="variant-grid" data-variant-form novalidate>
            <label>Price ৳<input name="price" inputmode="numeric" value="${v.price ?? ''}" placeholder="On request"></label>
            <label>Sale price ৳<input name="salePrice" inputmode="numeric" value="${v.salePrice ?? ''}" placeholder="None"></label>
            <label>Stock<input name="stock" inputmode="numeric" value="${v.stock}"></label>
            <label>Swatch<input name="swatch" type="color" value="${esc(v.swatch)}" style="padding:2px"></label>
            <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> On sale</label>
            <div class="actions"><button class="btn btn--small" type="submit" data-save disabled>Save</button></div>
          </form>
          <div>
            <h3 class="soft" style="font-size:13px;font-weight:500;margin-bottom:8px">Photos <span class="soft">· the first is the main photo; add every angle you have</span></h3>
            <div class="photos" data-photos></div>
          </div>
        </section>`).join('')}
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-file hidden>`;

    // Details
    $('[data-details]', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget; const err = $('[data-details-error]', main);
      err.textContent = '';
      try {
        const { product } = await api(`/api/admin/products/${encodeURIComponent(p.slug)}`, {
          method: 'PUT',
          body: { name: f.name.value, collection: f.collection.value, warrantyYears: f.warrantyYears.value.trim(), features: f.features.value, description: f.description.value },
        });
        $('h1', main).textContent = product.name;
        toast(`${product.name} saved. The store shows it now.`);
      } catch (ex) { err.textContent = ex.message; }
    });

    // Colours: price, stock, swatch, on sale
    $$('[data-variant]', main).forEach((card) => {
      const id = card.dataset.variant;
      const f = $('[data-variant-form]', card);
      const save = $('[data-save]', f);
      $$('input', f).forEach((inp) => inp.addEventListener('input', () => { card.classList.add('is-dirty'); save.disabled = false; }));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (n) => { const s = f[n].value.trim().replace(/,/g, ''); return s === '' ? null : Number(s); };
        save.disabled = true;
        try {
          const { variant } = await api(`/api/admin/variants/${id}`, {
            method: 'PATCH',
            body: { price: val('price'), salePrice: val('salePrice'), stock: val('stock') ?? 0, swatch: f.swatch.value, active: f.active.checked },
          });
          card.classList.remove('is-dirty');
          card.classList.toggle('is-off', !variant.active);
          $('.swatch', card).style.setProperty('--c', variant.swatch);
          toast(`${variant.colour} saved. The store shows it now.`);
        } catch (ex) { save.disabled = false; toast(ex.message); }
      });
      renderPhotos(card, p.variants.find((v) => v.id === id));
    });

    // Photos: add (several at once), make main, move, remove. Each change saves at once.
    const file = $('[data-file]', main);
    let target = null;
    file.addEventListener('change', async () => {
      const files = [...file.files];
      if (!files.length || !target) return;
      const card = target; const add = $('[data-add-photo]', card);
      add.disabled = true; add.textContent = 'Uploading…';
      let v = null;
      try {
        for (const f of files) {
          const dataUrl = await resizeImage(f, 1600);
          ({ variant: v } = await api(`/api/admin/variants/${card.dataset.variant}/photos`, { method: 'POST', body: { dataUrl } }));
        }
        toast(files.length === 1 ? 'Photo added' : `${files.length} photos added`);
      } catch (ex) { toast(ex.message); }
      if (v) renderPhotos(card, v); else { add.disabled = false; add.textContent = '+ Add photos'; }
    });

    function renderPhotos(card, v) {
      const list = [v.image, ...v.gallery].filter(Boolean);
      const box = $('[data-photos]', card);
      box.innerHTML = `${list.map((src, i) => `
        <figure class="photo" data-src="${esc(src)}">
          <img src="/${esc(src)}" alt="Photo ${i + 1} of ${esc(v.colour)}" loading="lazy">
          ${i === 0 ? '<span class="photo-main">Main</span>' : ''}
          <figcaption>
            <button type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move left">←</button>
            ${i === 0 ? '' : '<button type="button" data-main>Main</button>'}
            <button type="button" data-move="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move right">→</button>
            <button type="button" data-remove aria-label="Remove photo">✕</button>
          </figcaption>
        </figure>`).join('')}
        <button class="photo photo--add" type="button" data-add-photo>+ Add photos</button>`;
      $('[data-add-photo]', box).addEventListener('click', () => { target = card; file.value = ''; file.click(); });
      const put = async (next, msg) => {
        try {
          const { variant } = await api(`/api/admin/variants/${v.id}/photos`, { method: 'PUT', body: { photos: next } });
          renderPhotos(card, variant); toast(msg);
        } catch (ex) { toast(ex.message); }
      };
      $$('.photo[data-src]', box).forEach((fig, i) => {
        $$('[data-move]', fig).forEach((b) => b.addEventListener('click', () => {
          const next = [...list]; const j = i + Number(b.dataset.move);
          [next[i], next[j]] = [next[j], next[i]];
          put(next, 'Photo order saved');
        }));
        $('[data-main]', fig)?.addEventListener('click', () => put([list[i], ...list.filter((_, k) => k !== i)], 'Main photo changed'));
        $('[data-remove]', fig).addEventListener('click', () => {
          if (!confirm('Remove this photo from the chair?')) return;
          put(list.filter((_, k) => k !== i), 'Photo removed');
        });
      });
    }

    $('[data-add-colour]', main).addEventListener('click', () => addVariant(collections, { model: p.model, collection: p.collection, warrantyYears: p.warrantyYears }));
  }

  // ---------- Quick stock edit ----------
  async function stock(focusId) {
    const { variants, collections } = await api('/api/admin/variants');
    main.innerHTML = `
      <div class="head"><div style="display:grid;gap:6px"><a class="soft" href="#products">← All products</a><h1>Quick stock edit</h1></div></div>
      <div class="tools">
        <input type="search" placeholder="Search name, model or colour" value="${esc(productState.q)}" data-search aria-label="Search products">
        <select data-collection aria-label="Category"><option value="">All categories</option>${Object.entries(collections).map(([k, v]) => `<option value="${k}"${productState.collection === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <span class="soft" data-count></span>
      </div>
      <p class="soft">Change a price, sale price or stock and press Save on that row. Leave the sale price empty for no sale. Untick "On sale" to hide a colour from the store. Click a chair's name to edit its photos and details.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Photo</th><th>Chair</th><th>Category</th><th class="num">Price ৳</th><th class="num">Sale ৳</th><th class="num">Stock</th><th>On sale</th><th></th></tr></thead>
        <tbody data-rows>${variants.map((v) => `
          <tr data-id="${esc(v.id)}" class="${v.active ? '' : 'is-off'}" data-search-text="${esc(`${v.name} ${v.colour}`.toLowerCase())}" data-coll="${esc(v.collection)}">
            <td><span class="prod-thumb">${v.image ? `<img src="/${esc(v.image)}" alt="" loading="lazy">` : ''}</span></td>
            <td><a href="#products/${esc(v.id)}"><i class="swatch" style="--c:${esc(v.swatch)}"></i>${esc(v.name)}</a> <span class="soft">${esc(v.colour)}</span></td>
            <td class="soft">${esc(collections[v.collection] || v.collection)}</td>
            <td class="num"><input class="cell-input" name="price" inputmode="numeric" value="${v.price ?? ''}" aria-label="Price"></td>
            <td class="num"><input class="cell-input" name="salePrice" inputmode="numeric" value="${v.salePrice ?? ''}" aria-label="Sale price"></td>
            <td class="num"><input class="cell-input ${v.stock <= 0 ? 'stock-out' : v.stock <= 10 ? 'stock-low' : ''}" name="stock" inputmode="numeric" value="${v.stock}" aria-label="Stock"></td>
            <td><input type="checkbox" name="active" ${v.active ? 'checked' : ''} aria-label="On sale" style="width:auto;min-height:0"></td>
            <td><button class="btn btn--small" type="button" data-save disabled>Save</button></td>
          </tr>`).join('')}</tbody>
      </table></div>`;

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
          toast(`${variant.name} ${variant.colour} saved. The store shows it now.`);
        } catch (ex) { save.disabled = false; toast(ex.message); }
      });
    });

    if (focusId) {
      const tr = rows.find((r) => r.dataset.id === focusId);
      if (tr) { tr.scrollIntoView({ block: 'center' }); $('[name="stock"]', tr).focus(); }
    }
  }

  // Photos are resized in the browser to at most 1600px, then sent as a JPEG.
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

  // preset: { model, collection, warrantyYears } when adding a colour to an existing chair.
  function addVariant(collections, preset = null) {
    openPanel(`
      <h2 id="panel-title">${preset ? `Add a colour to ${esc(preset.model)}` : 'Add a chair'}</h2>
      <p class="soft">${preset ? 'The new colour is added to this chair.' : 'Use an existing model number to add a colour to it, or a new one for a new chair.'} You can add its photos on the next page.</p>
      <form class="form-grid" data-add-form novalidate>
        <label>Model number<input name="model" required placeholder="e.g. 6859A" value="${esc(preset?.model || '')}" ${preset ? 'readonly' : ''}></label>
        <label>Colour<input name="colour" required placeholder="e.g. Black"></label>
        <label>Category<select name="collection">${Object.entries(collections).map(([k, v]) => `<option value="${k}"${preset?.collection === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Swatch colour<input name="swatch" type="color" value="#1d1d1f" style="padding:2px"></label>
        <label>Price ৳<input name="price" inputmode="numeric" placeholder="e.g. 9500"></label>
        <label>Sale price ৳ <span class="soft">(optional)</span><input name="salePrice" inputmode="numeric"></label>
        <label>Stock<input name="stock" inputmode="numeric" value="0"></label>
        <label>Warranty (years)<input name="warrantyYears" inputmode="numeric" value="${preset?.warrantyYears ?? 2}"></label>
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
        toast(`${variant.name} ${variant.colour} added`);
        const next = `products/${variant.id}`;
        if (location.hash.slice(1) === next) route(); else location.hash = next;
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
            : `<label class="full"><span>Districts <span class="soft">(separate with commas)</span></span><textarea name="districts" rows="2">${esc(z.districts.join(', '))}</textarea></label>`}
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
          <label class="full"><span>New password <span class="soft">(at least 10 characters)</span></span><input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
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
