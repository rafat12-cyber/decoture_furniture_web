// Home page below the chair scene: categories, selected chairs and the office quote form.
(function () {
  'use strict';
  const D = window.Decoture;
  const { products, catalog, esc, money } = D;

  const prices = products.map(D.productFromPrice).filter((n) => n != null);
  document.querySelectorAll('[data-from-price]').forEach((el) => { el.textContent = prices.length ? money(Math.min(...prices)) : 'price on request'; });
  const totalStock = products.reduce((n, p) => n + D.productStock(p), 0);
  document.querySelectorAll('[data-total-stock]').forEach((el) => { el.dataset.count = totalStock; el.textContent = totalStock.toLocaleString('en-IN'); });

  document.querySelectorAll('[data-model-count]').forEach((el) => { el.textContent = products.length; });
  document.querySelectorAll('[data-cat-count]').forEach((el) => { el.textContent = Object.keys(catalog.collections).length; });

  // ---------- Categories: one tile each, with a chair that stands for it ----------
  const COVER = { executive: '6837a', ergonomic: 'a12', task: 'c-2301', conference: 'cds-155-l', training: 'fcr-111' };
  const inColl = (k) => products.filter((p) => p.collection === k);
  document.querySelector('[data-cats]').innerHTML = Object.entries(catalog.collections).map(([k, c], i) => {
    const list = inColl(k);
    const cover = D.bySlug.get(COVER[k]) || list.find((p) => D.firstImage(p));
    const img = cover ? D.firstImage(cover) : D.PLACEHOLDER;
    return `
      <a class="cat cat--${i < 2 ? 'wide' : 'narrow'}" href="shop.html?collection=${k}" data-reveal style="--d:${i * 70}ms">
        <span class="cat-frame"><img src="${img}" alt="" width="400" height="500" loading="lazy"></span>
        <span class="cat-body">
          <span class="cat-name">${esc(c.name)}</span>
          <span class="cat-blurb">${esc(c.blurb)}</span>
          <span class="cat-more">${list.length} ${list.length === 1 ? 'model' : 'models'}<span aria-hidden="true"> →</span></span>
        </span>
      </a>`;
  }).join('');

  // ---------- Selected chairs, a row of four per category ----------
  const PICKS = {
    executive: ['6837a', '6859a', '6832a', '6801a'],
    ergonomic: ['a12', 'gmc-5d', 'a31', 'a7901'],
    task: ['c-2301', 'c-758', 'b10', 'b3004'],
    conference: ['cds-155-l', 'cds-155-m', 'cfv-152-r'],
    training: ['d113', 'fcr-109', 'fcr-110', 'fcr-111'],
  };
  const tabs = document.querySelector('[data-feat-tabs]');
  const featured = document.querySelector('[data-featured]');
  tabs.innerHTML = Object.entries(catalog.collections).map(([k, c]) => `<button type="button" role="tab" class="feat-tab" data-k="${k}">${esc(c.name)}</button>`).join('');
  function showFeatured(k) {
    const picked = (PICKS[k] || []).map((s) => D.bySlug.get(s)).filter(Boolean);
    const list = picked.concat(inColl(k).filter((p) => D.firstImage(p) && !picked.includes(p))).slice(0, 4);
    featured.innerHTML = list.map((p, i) => D.cardHTML(p, i)).join('');
    tabs.querySelectorAll('[data-k]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === k)));
    D.reveal(featured);
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) showFeatured(b.dataset.k); });
  showFeatured('executive');

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
    if (!D.live) { D.openExternal(D.whatsappLink(`Hello Decoture, I would like a quote for office chairs.\nName: ${name}\nPhone: ${phone}`)); return; }
    D.api('/api/quotes', { method: 'POST', body: { name, phone, items: 'Asked for a call back from the home page' } })
      .then(() => { form.reset(); D.toast(`Thank you, ${name.split(' ')[0]}. We will call you soon.`); })
      .catch((ex) => { err.textContent = ex.status ? ex.message : 'We could not reach the store. Please call us instead.'; });
  });
  if (D.live) document.querySelector('[data-quote-note]').textContent = 'We call you back, usually within one working day.';

  D.reveal();
})();
