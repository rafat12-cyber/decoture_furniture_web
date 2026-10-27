// Product page: colour variants, stock, quantity and add to cart.
(function () {
  'use strict';
  const D = window.Decoture;
  const { catalog, esc } = D;
  const params = new URLSearchParams(location.search || location.hash.replace(/^#/, '?'));
  const p = D.bySlug.get(params.get('m')) || D.products[0];
  let v = p.variants.find((x) => x.id === params.get('c')) || p.variants.find((x) => x.stock > 0 && x.image) || p.variants[0];
  const coll = catalog.collections[p.collection];
  const root = document.querySelector('[data-product]');

  document.title = `${p.name} ${coll.name} chair · Decoture`;
  document.querySelector('[data-crumbs]').insertAdjacentHTML('beforeend',
    `<span aria-hidden="true">/</span><a href="shop.html?collection=${p.collection}">${esc(coll.name)}</a><span aria-hidden="true">/</span><span>${esc(p.name)}</span>`);

  const warranty = p.warrantyYears === 1
    ? '1 year of free service for any manufacturing fault. Rexine and fabric are not covered.'
    : '2 years on the mechanism, gas lift, base and wheels.';

  root.innerHTML = `
    <article class="product">
      <div class="product-media">
        <div class="stage"><img data-stage src="" alt="" width="400" height="500"></div>
        ${p.variants.length > 1 ? `<div class="thumbs" role="group" aria-label="Colour photos">${p.variants.map((x) => `
          <button type="button" data-thumb="${x.id}" aria-label="${esc(x.colour)}" aria-pressed="false"><img src="${x.image || D.PLACEHOLDER}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="product-info">
        <div>
          <h1>${esc(p.name)}</h1>
          <p class="subtitle">${esc(coll.name)} chair${p.features.length ? ' · ' + p.features.map(esc).join(' · ') : ''}</p>
        </div>
        <p class="price" data-price></p>
        <div class="variant-picker">
          <fieldset>
            <legend>Colour: <span data-colour-name></span></legend>
            <div class="variant-options">${p.variants.map((x) => `
              <button type="button" class="swatch${x.stock <= 0 ? ' is-out' : ''}" style="--c:${x.swatch}" data-variant="${x.id}" aria-label="${esc(x.colour)}${x.stock <= 0 ? ', out of stock' : ''}" title="${esc(x.colour)}" aria-pressed="false"></button>`).join('')}
            </div>
          </fieldset>
        </div>
        <p class="status" data-status></p>
        <div class="buy-row">
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" data-dec aria-label="Decrease quantity">−</button>
            <input type="number" inputmode="numeric" min="1" value="1" data-qty aria-label="Quantity">
            <button type="button" data-inc aria-label="Increase quantity">+</button>
          </div>
          <button class="button" type="button" data-add>Add to cart</button>
        </div>
        <p class="small soft">Cash on delivery. We call to confirm your order and the delivery charge.</p>
        <p>${esc(p.description)}</p>
        <dl class="spec">
          <dt>Model</dt><dd>${esc(p.model)}</dd>
          <dt>Collection</dt><dd>${esc(coll.name)}</dd>
          <dt>Colours</dt><dd>${p.variants.map((x) => esc(x.colour)).join(', ')}</dd>
          <dt>Fittings</dt><dd>${p.warrantyYears === 1 ? 'Chrome base' : 'Fully foreign fittings'}</dd>
          <dt>Warranty</dt><dd>${warranty}</dd>
        </dl>
        <div class="warranty-figure">
          <img src="assets/img/brand/warranty-card.jpg" alt="Decoture warranty certificate" width="120" height="90" loading="lazy">
          <p class="soft">Every chair ships with a Decoture warranty card. Keep it with your invoice for any claim.</p>
        </div>
        <p class="note-box"><strong>Buying ten or more?</strong> <a class="link" href="offices.html">Ask for an office quote</a> and we will hold matching stock for you.</p>
      </div>
    </article>`;

  const stage = root.querySelector('[data-stage]');
  const qty = root.querySelector('[data-qty]');
  const add = root.querySelector('[data-add]');

  function select(next, swap) {
    v = next;
    const img = v.image || D.PLACEHOLDER;
    if (swap && stage.getAttribute('src') !== img) {
      stage.classList.add('is-swapping');
      setTimeout(() => { stage.src = img; stage.classList.remove('is-swapping'); }, 150);
    } else stage.src = img;
    stage.alt = `${v.sku} chair${v.image ? '' : ' (photo coming soon)'}`;
    root.querySelector('[data-colour-name]').textContent = v.colour;
    root.querySelector('[data-price]').innerHTML = v.salePrice != null && v.price != null
      ? `${D.money(v.salePrice)}<s>${D.money(v.price)}</s>` : D.priceLabel(v);
    const s = D.stockState(v);
    const st = root.querySelector('[data-status]');
    st.className = `status status--${s.key}`;
    st.textContent = s.key === 'out' ? 'Out of stock in this colour. Call us for the next shipment.' : s.label;
    qty.max = Math.max(1, v.stock);
    qty.value = Math.min(+qty.value || 1, Math.max(1, v.stock));
    add.disabled = v.stock <= 0;
    add.textContent = v.stock <= 0 ? 'Out of stock' : 'Add to cart';
    root.querySelectorAll('[data-variant]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.variant === v.id)));
    root.querySelectorAll('[data-thumb]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.thumb === v.id)));
    try { history.replaceState(null, '', D.productUrl(p, v)); } catch { /* sandboxed */ }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-variant], [data-thumb]');
    if (b) select(p.variants.find((x) => x.id === (b.dataset.variant || b.dataset.thumb)), true);
    if (e.target.closest('[data-inc]')) qty.value = Math.min(+qty.max, (+qty.value || 1) + 1);
    if (e.target.closest('[data-dec]')) qty.value = Math.max(1, (+qty.value || 1) - 1);
  });
  add.addEventListener('click', () => {
    const n = Math.max(1, Math.min(v.stock, +qty.value || 1));
    if (D.cart.add(v.id, n)) {
      window.Motion?.fly(stage);
      setTimeout(D.openDrawer, window.Motion && !window.Motion.reduce ? 760 : 0);
    }
  });
  select(v, false);

  // Related: same collection, those with photos first.
  const related = D.products.filter((x) => x.collection === p.collection && x !== p && D.firstImage(x)).slice(0, 4);
  const wrap = document.querySelector('[data-related-wrap]');
  if (related.length) document.querySelector('[data-related]').innerHTML = related.map(D.cardHTML).join('');
  else wrap.hidden = true;
  D.reveal();
})();
