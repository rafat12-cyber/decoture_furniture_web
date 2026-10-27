// Shop: filter by collection, colour and stock; sort; state kept in the URL.
(function () {
  'use strict';
  const D = window.Decoture;
  const { products, catalog, esc } = D;
  const params = new URLSearchParams(location.search);
  const state = {
    collection: catalog.collections[params.get('collection')] ? params.get('collection') : '',
    colour: D.FAMILIES.some((f) => f.key === params.get('colour')) ? params.get('colour') : '',
    inStock: params.get('stock') === '1',
    sort: params.get('sort') || 'featured',
  };

  const chips = document.querySelector('[data-collection-chips]');
  const colours = document.querySelector('[data-colour-filter]');
  const inStock = document.querySelector('[data-instock]');
  const sort = document.querySelector('[data-sort]');
  const grid = document.querySelector('[data-grid]');
  const empty = document.querySelector('[data-empty]');
  const count = document.querySelector('[data-result-count]');
  const title = document.querySelector('[data-shop-title]');
  const blurb = document.querySelector('[data-shop-blurb]');
  const defaultBlurb = blurb.textContent;

  const countIn = (k) => products.filter((p) => p.collection === k).length;
  chips.innerHTML = `<button type="button" class="chip" data-c="">All<span class="n">${products.length}</span></button>` +
    Object.entries(catalog.collections).map(([k, c]) => `<button type="button" class="chip" data-c="${k}">${esc(c.name)}<span class="n">${countIn(k)}</span></button>`).join('');
  colours.innerHTML = D.FAMILIES.map((f) => `<button type="button" class="swatch" style="--c:${f.hex}" data-f="${f.key}" aria-label="${f.label}" title="${f.label}"></button>`).join('');
  inStock.checked = state.inStock;
  sort.value = state.sort;

  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { state.collection = b.dataset.c; render(); } });
  colours.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { state.colour = state.colour === b.dataset.f ? '' : b.dataset.f; render(); } });
  inStock.addEventListener('change', () => { state.inStock = inStock.checked; render(); });
  sort.addEventListener('change', () => { state.sort = sort.value; render(); });
  document.querySelector('[data-reset]').addEventListener('click', () => {
    Object.assign(state, { collection: '', colour: '', inStock: false, sort: 'featured' });
    inStock.checked = false; sort.value = 'featured'; render();
  });

  const featuredOrder = ['executive', 'ergonomic', 'task', 'training'];
  function render() {
    let list = products.filter((p) => {
      if (state.collection && p.collection !== state.collection) return false;
      const vs = p.variants.filter((v) => (!state.colour || D.familyOf(v) === state.colour) && (!state.inStock || v.stock > 0));
      return vs.length > 0;
    });
    const price = (p) => D.productFromPrice(p) ?? Infinity;
    const sorters = {
      featured: (a, b) => featuredOrder.indexOf(a.collection) - featuredOrder.indexOf(b.collection) || (D.firstImage(b) ? 1 : 0) - (D.firstImage(a) ? 1 : 0),
      stock: (a, b) => D.productStock(b) - D.productStock(a),
      'price-asc': (a, b) => price(a) - price(b),
      'price-desc': (a, b) => (D.productFromPrice(b) ?? -1) - (D.productFromPrice(a) ?? -1),
      name: (a, b) => a.model.localeCompare(b.model, 'en', { numeric: true }),
    };
    list = [...list].sort(sorters[state.sort] || sorters.featured);

    chips.querySelectorAll('[data-c]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === state.collection)));
    colours.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === state.colour)));
    const coll = catalog.collections[state.collection];
    title.textContent = coll ? `${coll.name} chairs` : 'All chairs';
    blurb.textContent = coll ? coll.blurb : defaultBlurb;
    document.title = `${title.textContent} · Decoture`;

    // Show the matching colourway first on each card when a colour is chosen.
    grid.innerHTML = list.map((p, i) => {
      if (!state.colour) return D.cardHTML(p, i);
      const v = p.variants.find((x) => D.familyOf(x) === state.colour && x.image);
      return D.cardHTML(v ? { ...p, variants: [v, ...p.variants.filter((x) => x !== v)] } : p, i);
    }).join('');
    empty.hidden = list.length > 0;
    const fam = D.FAMILIES.find((f) => f.key === state.colour);
    count.textContent = `${list.length} ${list.length === 1 ? 'model' : 'models'}${fam ? ` in ${fam.label.toLowerCase()}` : ''}${state.inStock ? ', in stock' : ''}`;

    const q = new URLSearchParams();
    if (state.collection) q.set('collection', state.collection);
    if (state.colour) q.set('colour', state.colour);
    if (state.inStock) q.set('stock', '1');
    if (state.sort !== 'featured') q.set('sort', state.sort);
    try { history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname); } catch { /* sandboxed */ }
    D.reveal(grid);
  }
  render();
})();
