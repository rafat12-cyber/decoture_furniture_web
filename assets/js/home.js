// Home page: colour studio, pinned collections, featured line, chair band and quote form.
(function () {
  'use strict';
  const D = window.Decoture;
  const M = window.Motion;
  const { products, catalog, esc, money } = D;

  const prices = products.map(D.productFromPrice).filter((n) => n != null);
  document.querySelectorAll('[data-from-price]').forEach((el) => { el.textContent = prices.length ? money(Math.min(...prices)) : 'price on request'; });
  const totalStock = products.reduce((n, p) => n + D.productStock(p), 0);
  document.querySelectorAll('[data-total-stock]').forEach((el) => { el.dataset.count = totalStock; el.textContent = totalStock.toLocaleString('en-IN'); });

  // ---------- Colour studio ----------
  const STUDIO = ['a40', '6859a', 'a3903-1', 'a12', '6838a', 'a823', 'a32']
    .map((s) => D.bySlug.get(s))
    .filter((p) => p && p.variants.filter((v) => v.image).length > 1);
  const modelsBox = document.querySelector('[data-studio-models]');
  const swBox = document.querySelector('[data-studio-swatches]');
  const img = document.querySelector('[data-studio-img]');
  const ghost = document.querySelector('[data-studio-ghost]');
  const stage = document.querySelector('[data-studio-stage]');
  const nameEl = document.querySelector('[data-studio-name]');
  const collEl = document.querySelector('[data-studio-coll]');
  const colourEl = document.querySelector('[data-studio-colour]');
  const priceEl = document.querySelector('[data-studio-price]');
  const addBtn = document.querySelector('[data-studio-add]');
  const link = document.querySelector('[data-studio-link]');
  let current = STUDIO[0];
  let variant = current.variants.find((v) => v.image);
  let auto = !M.reduce;

  modelsBox.innerHTML = STUDIO.map((p) => `<button type="button" class="pill" data-model="${p.slug}">${esc(p.model)}</button>`).join('');

  function swapImage(src, alt) {
    if (M.reduce || img.getAttribute('src') === src) { img.src = src; img.alt = alt; return; }
    img.classList.add('is-out');
    setTimeout(() => {
      img.src = src; img.alt = alt;
      const show = () => { img.classList.remove('is-out'); img.classList.add('is-in-anim'); setTimeout(() => img.classList.remove('is-in-anim'), 700); };
      if (img.complete) requestAnimationFrame(show); else img.onload = show;
    }, 260);
  }
  function renderStudio(model, v, fromModel) {
    current = model; variant = v;
    modelsBox.querySelectorAll('[data-model]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.model === model.slug)));
    if (fromModel) {
      swBox.innerHTML = model.variants.filter((x) => x.image).map((x) => `<button type="button" class="swatch swatch--lg" style="--c:${x.swatch}" data-v="${x.id}" aria-label="${esc(x.colour)}" title="${esc(x.colour)}"></button>`).join('');
      if (ghost.textContent !== model.model) {
        ghost.classList.add('is-out');
        setTimeout(() => { ghost.textContent = model.model; ghost.classList.remove('is-out'); }, M.reduce ? 0 : 300);
      }
      nameEl.textContent = model.model;
      collEl.textContent = catalog.collections[model.collection].name;
    }
    swBox.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v.id)));
    stage.style.setProperty('--tint', v.swatch);
    swapImage(v.image, `${v.sku} chair`);
    const s = D.stockState(v);
    colourEl.innerHTML = `${esc(v.colour)} <span class="status status--${s.key}">· ${s.label}</span>`;
    priceEl.textContent = D.priceLabel(v);
    addBtn.disabled = v.stock <= 0;
    link.href = D.productUrl(model, v);
  }
  modelsBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-model]');
    if (!b) return;
    auto = false;
    const p = D.bySlug.get(b.dataset.model);
    renderStudio(p, p.variants.find((x) => x.image && x.stock > 0) || p.variants.find((x) => x.image), true);
  });
  swBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    auto = false;
    renderStudio(current, current.variants.find((x) => x.id === b.dataset.v), false);
  });
  addBtn.addEventListener('click', () => {
    if (D.cart.add(variant.id, 1)) {
      M.fly(img);
      D.toast(`Added ${variant.sku} to your cart`);
    }
  });
  renderStudio(current, variant, true);

  // Until someone touches it, the studio cycles colours, then models, while it is on screen.
  if (auto) {
    let visible = false;
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0.3 }).observe(stage);
    let step = 0;
    setInterval(() => {
      if (!auto || !visible || document.hidden) return;
      const vs = current.variants.filter((x) => x.image);
      const i = vs.indexOf(variant);
      step++;
      if (i < vs.length - 1) renderStudio(current, vs[i + 1], false);
      else {
        const next = STUDIO[(STUDIO.indexOf(current) + 1) % STUDIO.length];
        renderStudio(next, next.variants.find((x) => x.image), true);
      }
    }, 2400);
  }

  // ---------- Pinned collections ----------
  const track = document.querySelector('[data-hscroll-track]');
  const pick = (k) => products.filter((p) => p.collection === k && D.firstImage(p));
  const fanFor = {
    executive: ['6859a', '6856a', '6837a'],
    ergonomic: ['a40', 'a3903-1', 'gmc-5d'],
    task: ['c-758', 'b821', 'c-622'],
    training: ['d113', 'd164'],
  };
  track.innerHTML = Object.entries(catalog.collections).map(([k, c], i) => {
    const list = pick(k);
    const models = products.filter((p) => p.collection === k);
    const stock = models.reduce((n, p) => n + D.productStock(p), 0);
    const fan = (fanFor[k] || []).map((s) => D.bySlug.get(s)).filter(Boolean).concat(list).filter((p, n, a) => a.indexOf(p) === n).slice(0, 3);
    return `
      <article class="panel panel--${i % 2 ? 'cream' : 'dark'}" data-panel>
        <div class="panel-copy">
          <h3 class="panel-title">${esc(c.name)}</h3>
          <p class="panel-blurb">${esc(c.blurb)}</p>
          <dl class="panel-facts">
            <div><dt>Models</dt><dd class="tnum">${models.length}</dd></div>
            <div><dt>In stock</dt><dd class="tnum">${stock.toLocaleString('en-IN')}</dd></div>
          </dl>
          <a class="button ${i % 2 ? 'button--dark' : ''}" href="shop.html?collection=${k}">Shop ${esc(c.name.toLowerCase())}</a>
        </div>
        <div class="panel-fan" aria-hidden="true">
          ${fan.map((p, n) => `<img style="--n:${n - (fan.length - 1) / 2}" src="${D.firstImage(p)}" alt="" width="200" height="260" loading="lazy">`).join('')}
        </div>
      </article>`;
  }).join('');

  const hs = document.querySelector('[data-hscroll]');
  const hbar = document.querySelector('[data-hscroll-bar]');
  const panels = [...track.querySelectorAll('[data-panel]')];
  const pinned = () => window.matchMedia('(min-width: 861px)').matches && !M.reduce;
  function sizeHscroll() {
    if (!pinned()) { hs.style.height = ''; track.style.transform = ''; return; }
    const extra = track.scrollWidth - innerWidth;
    hs.style.height = `${innerHeight + Math.max(0, extra)}px`;
  }
  sizeHscroll();
  window.addEventListener('resize', sizeHscroll);
  window.addEventListener('load', sizeHscroll);
  M.addScrub(() => {
    if (!pinned()) return;
    const p = M.pinProgress(hs);
    const extra = Math.max(0, track.scrollWidth - innerWidth);
    track.style.transform = `translate3d(${(-p * extra).toFixed(1)}px,0,0)`;
    hbar.style.transform = `scaleX(${p})`;
    // Each panel's chairs fan open as the panel reaches the middle of the screen.
    panels.forEach((panel) => {
      const r = panel.getBoundingClientRect();
      const c = 1 - Math.min(1, Math.abs(r.left + r.width / 2 - innerWidth / 2) / innerWidth);
      panel.style.setProperty('--open', c.toFixed(3));
    });
  });
  if (!pinned()) panels.forEach((p) => p.style.setProperty('--open', 1));

  // ---------- Featured executive line ----------
  const featured = ['6859a', '6856a', '6838a', '6837a', '6832a', '6995a', '6801a', '6833a']
    .map((s) => D.bySlug.get(s)).filter(Boolean);
  document.querySelector('[data-featured]').innerHTML = featured.map((p, i) => D.cardHTML(p, i)).join('');

  // ---------- Chair band in the gold field ----------
  const bandChairs = products.flatMap((p) => p.variants.filter((v) => v.image).slice(0, 1)).filter((_, i) => i % 3 === 0).slice(0, 14);
  document.querySelector('[data-chair-band]').innerHTML = bandChairs.map((v) => `<figure><img src="${v.image}" alt="" width="120" height="150" loading="lazy"></figure>`).join('');

  // ---------- Quote form ----------
  const form = document.querySelector('[data-quote-form]');
  const err = document.querySelector('[data-quote-error]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    form.name.setAttribute('aria-invalid', String(!name));
    const phoneOk = /^[+\d][\d\s-]{6,}$/.test(phone);
    form.phone.setAttribute('aria-invalid', String(!phoneOk));
    if (!name || !phoneOk) { err.textContent = !name ? 'Please add your name.' : 'Please add a phone number we can call.'; return; }
    err.textContent = '';
    D.openExternal(D.whatsappLink(`Hello Decoture, I would like a quote for office chairs.\nName: ${name}\nPhone: ${phone}`));
  });

  D.reveal();
})();
