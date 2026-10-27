// Home page: the contact sheet hero, executive run, stock list, index and quote bar.
(function () {
  'use strict';
  const D = window.Decoture;
  const { products, catalog, esc, money } = D;

  // Shared counts in copy
  const variants = products.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const prices = products.map(D.productFromPrice).filter((n) => n != null);
  document.querySelectorAll('[data-model-count]').forEach((el) => { el.textContent = products.length; });
  document.querySelectorAll('[data-variant-count]').forEach((el) => { el.textContent = variants.length; });
  document.querySelectorAll('[data-from-price]').forEach((el) => { el.textContent = prices.length ? money(Math.min(...prices)) : 'price on request'; });
  document.querySelectorAll('[data-stock-date]').forEach((el) => {
    el.textContent = new Date(catalog.stockListDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  });

  // ---------- Hero sheet ----------
  // Interleave collections so neighbouring frames differ; six columns of six.
  const withImage = variants.filter(({ v }) => v.image);
  const order = [];
  const pools = ['executive', 'ergonomic', 'task', 'ergonomic', 'executive', 'task', 'training'].map((c) => c);
  const byColl = {};
  withImage.forEach((x) => { (byColl[x.p.collection] ||= []).push(x); });
  let guard = 0;
  while (order.length < 42 && guard++ < 400) {
    const c = pools[guard % pools.length];
    const pool = byColl[c];
    if (pool && pool.length) order.push(pool.splice((guard * 7) % pool.length, 1)[0]);
  }
  const sheet = document.querySelector('[data-sheet]');
  const cols = Array.from({ length: 6 }, () => document.createElement('div'));
  cols.forEach((c) => { c.className = 'sheet-col'; sheet.append(c); });
  order.forEach(({ p, v }, i) => {
    const a = document.createElement('a');
    a.className = 'frame';
    a.href = D.productUrl(p, v);
    a.dataset.family = D.familyOf(v) || '';
    a.style.setProperty('--d', `${(i % 6) * 70 + Math.floor(i / 6) * 40}ms`);
    a.innerHTML = `<img src="${v.image}" alt="${esc(v.sku)} chair" width="200" height="260"${i < 12 ? '' : ' loading="lazy"'}>
      <span class="frame-strip strip-${(i + Math.floor(i / 6)) % 4}"><span class="model">${esc(p.model)}</span><span>${esc(v.colour)}</span></span>`;
    cols[i % 6].append(a);
  });

  // The live thing: pick a colour, the sheet shows which chairs come in it.
  const swatchBox = document.querySelector('[data-hero-swatches]');
  const result = document.querySelector('[data-picker-result]');
  const familyCounts = Object.fromEntries(D.FAMILIES.map((f) => [f.key, variants.filter(({ v }) => D.familyOf(v) === f.key)]));
  swatchBox.innerHTML = `<button type="button" class="swatch-all" aria-pressed="true" data-family="">All</button>` +
    D.FAMILIES.map((f) => `<button type="button" class="swatch" style="--c:${f.hex}" aria-pressed="false" data-family="${f.key}" aria-label="${f.label}" title="${f.label}"></button>`).join('');
  swatchBox.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const fam = btn.dataset.family;
    swatchBox.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    sheet.querySelectorAll('.frame').forEach((f) => f.classList.toggle('is-dimmed', !!fam && f.dataset.family !== fam));
    if (!fam) { result.textContent = ''; return; }
    const list = familyCounts[fam];
    const models = new Set(list.map(({ p }) => p.slug)).size;
    const label = D.FAMILIES.find((f) => f.key === fam).label.toLowerCase();
    result.innerHTML = `${models} ${models === 1 ? 'model comes' : 'models come'} in ${esc(label)}. <a class="link" href="shop.html?colour=${fam}">Show them</a>`;
  });

  // ---------- Executive run, one frame lifted ----------
  const run = document.querySelector('[data-run]');
  ['6801a', '6856a', '6859a', '6838a'].map((k) => D.bySlug.get(k)).filter(Boolean).forEach((p, i) => {
    const v = p.variants.find((x) => x.image);
    const isLifted = p.slug === '6859a';
    const fact = p.variants.length > 1 ? `${p.variants.length} colours` : v.colour;
    const a = document.createElement('a');
    a.className = 'run-item' + (isLifted ? ' lifted' : '');
    a.href = D.productUrl(p, v);
    if (!isLifted) { a.dataset.reveal = ''; a.style.setProperty('--d', `${i * 60}ms`); }
    a.innerHTML = `<span class="shot${isLifted ? ' shutter' : ''}"><img src="${v.image}" alt="${esc(v.sku)} executive chair" width="200" height="260" loading="lazy"></span>
      <span class="caption"><span>${esc(p.model)}</span><span>${esc(fact)}</span></span>`;
    run.append(a);
  });

  // ---------- Stock list ----------
  const groups = document.querySelector('[data-stock-groups]');
  const ranked = variants.filter(({ v }) => v.stock > 0).sort((a, b) => b.v.stock - a.v.stock);
  const deep = ranked.slice(0, 12);
  const low = ranked.filter(({ v }) => v.stock <= D.CONFIG.lowStock).sort((a, b) => a.v.stock - b.v.stock);
  const row = ({ p, v }) => {
    const s = D.stockState(v);
    const value = v.stock >= 100 ? `${Math.floor(v.stock / 100) * 100}+ ready` : s.label;
    return `<a class="stock-row" href="${D.productUrl(p, v)}"><span class="name"><span class="dot" style="--c:${v.swatch}"></span><span>${esc(v.sku)}</span></span><span class="value${s.key === 'low' ? ' low' : ''}">${value}</span></a>`;
  };
  groups.innerHTML = `
    <div class="stock-group" data-reveal><p>Deepest stock</p>${deep.map(row).join('')}</div>
    ${low.length ? `<div class="stock-group" data-reveal><p>Last few</p>${low.map(row).join('')}</div>` : ''}`;

  // ---------- Index ----------
  const collList = document.querySelector('[data-index-collections]');
  collList.innerHTML = Object.entries(catalog.collections).map(([k, c]) => {
    const n = products.filter((p) => p.collection === k).length;
    return `<li data-detail="${esc(c.blurb)} ${n} models."><a href="shop.html?collection=${k}">${esc(c.name)}</a></li>`;
  }).join('');
  const detail = document.querySelector('[data-index-detail]');
  const showDetail = (e) => {
    const li = e.target.closest('li[data-detail]');
    if (!li) return;
    document.querySelectorAll('.index-col li.is-on').forEach((x) => x.classList.remove('is-on'));
    li.classList.add('is-on');
    detail.textContent = li.dataset.detail;
  };
  document.querySelectorAll('.index-col').forEach((col) => {
    col.addEventListener('mouseover', showDetail);
    col.addEventListener('focusin', showDetail);
  });

  // ---------- Record lists ----------
  document.querySelector('[data-record-collections]').innerHTML = Object.entries(catalog.collections).map(([k, c]) => {
    const n = products.filter((p) => p.collection === k).length;
    return `<li><span>${esc(c.name)}</span><span class="tnum">${n} models</span></li>`;
  }).join('');

  // ---------- Marquee: chairs and the brand's own photographs ----------
  const brand = [
    ['assets/img/brand/hang-tags.jpg', 'Decoture hang tags and fabric swatches on a leather sofa'],
    ['assets/img/brand/warranty-card.jpg', 'Decoture warranty certificate and care guide'],
    ['assets/img/brand/showroom-sign.jpg', 'Decoture showroom sign on the pavement'],
    ['assets/img/brand/catalogue.jpg', 'Decoture catalogues on a marble table'],
  ];
  const ratios = ['r34', 'r11', 'r32'];
  const chairs = withImage.filter((_, i) => i % 7 === 3).slice(0, 10);
  const frames = [];
  chairs.forEach((x, i) => {
    frames.push(`<figure class="chair r34"><img src="${x.v.image}" alt="" loading="lazy" width="120" height="160"></figure>`);
    if (i % 3 === 1 && brand[(i / 3) | 0]) {
      const [src] = brand[(i / 3) | 0];
      frames.push(`<figure class="${ratios[(i % 2) + 1]}"><img src="${src}" alt="" loading="lazy" width="225" height="150"></figure>`);
    }
  });
  const track = document.querySelector('[data-marquee]');
  track.innerHTML = frames.join('') + frames.join('');

  // ---------- Quote bar ----------
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
    const text = `Hello Decoture, I would like a quote for office chairs.\nName: ${name}\nPhone: ${phone}`;
    D.openExternal(D.whatsappLink(text));
  });

  D.reveal();
})();
