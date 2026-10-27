// Checkout: cash on delivery. On the live store the order goes to the server; on a static host
// it is saved in the browser and handed to WhatsApp or email.
(function () {
  'use strict';
  const D = window.Decoture;
  const form = document.querySelector('[data-checkout-form]');
  const err = document.querySelector('[data-form-error]');
  const linesBox = document.querySelector('[data-checkout-lines]');
  const totals = document.querySelector('[data-cart-totals]');

  if (!D.cart.count()) { location.replace('cart.html'); return; }

  const DISTRICTS = ['Dhaka', 'Gazipur', 'Narayanganj', 'Chattogram', 'Sylhet', 'Rajshahi', 'Khulna', 'Barishal', 'Rangpur', 'Mymensingh', 'Cumilla', 'Bogura', "Cox's Bazar", 'Jashore', 'Narsingdi', 'Tangail', 'Other district'];
  form.district.insertAdjacentHTML('beforeend', DISTRICTS.map((d) => `<option>${D.esc(d)}</option>`).join(''));
  form.district.value = 'Dhaka';

  function renderSummary() {
    linesBox.innerHTML = D.cart.items().map((i) => `
      <div class="line-item" style="grid-template-columns:56px 1fr auto">
        <div class="thumb" style="width:56px;height:68px"><img src="${i.variant.image || D.PLACEHOLDER}" alt="" style="max-height:62px"></div>
        <div><h3>${D.esc(i.product.name)}</h3><p class="meta">${D.esc(i.variant.colour)} · Qty ${i.qty}</p></div>
        <div class="line-total">${D.variantPrice(i.variant) == null ? '' : D.money(D.variantPrice(i.variant) * i.qty)}</div>
      </div>`).join('');
    totals.innerHTML = D.totalsHTML();
  }
  renderSummary();
  D.cart.subscribe(renderSummary);

  const required = ['name', 'phone', 'district', 'area', 'address'];
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let firstBad = null;
    required.forEach((n) => {
      const el = form[n];
      let ok = el.value.trim() !== '';
      if (n === 'phone') ok = /^(\+?88)?0?1[3-9]\d{8}$/.test(el.value.replace(/[\s-]/g, ''));
      el.setAttribute('aria-invalid', String(!ok));
      if (!ok && !firstBad) firstBad = el;
    });
    if (firstBad) {
      err.textContent = firstBad.name === 'phone' ? 'Please enter a Bangladeshi mobile number, for example 01712345678.' : 'Please fill in the highlighted fields.';
      firstBad.focus();
      return;
    }
    err.textContent = '';
    const details = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      district: form.district.value,
      area: form.area.value.trim(),
      address: form.address.value.trim(),
      note: form.note.value.trim(),
      payment: form.payment.value,
    };
    if (D.live) placeOnServer(details); else placeInBrowser(details);
  });

  // The live store: the server checks stock and prices, saves the order and holds the chairs.
  const submit = form.querySelector('[type="submit"]');
  async function placeOnServer(details) {
    submit.disabled = true;
    submit.textContent = 'Placing your order…';
    try {
      const { order } = await D.api('/api/orders', {
        method: 'POST',
        body: { ...details, items: D.cart.items().map((i) => ({ id: i.id, qty: i.qty })) },
      });
      D.orders.save({ ...order, ...details, server: true });
      D.cart.clear();
      location.href = `order.html?id=${encodeURIComponent(order.id)}`;
    } catch (e) {
      submit.disabled = false;
      submit.textContent = 'Place order';
      const data = e.data || {};
      if (e.status === 409 && data.variant) {
        // Stock changed since the cart was filled: fix the cart and say what happened.
        if (data.available > 0) D.cart.setQty(data.variant, data.available); else D.cart.remove(data.variant);
        err.textContent = `${e.message} We have updated your cart. Please check it and place the order again.`;
        if (!D.cart.count()) location.replace('cart.html');
        return;
      }
      if (data.field && form[data.field]) { form[data.field].setAttribute('aria-invalid', 'true'); form[data.field].focus(); }
      err.textContent = e.status ? e.message : 'We could not reach the store. Check your connection and try again, or call us on ' + D.CONFIG.phone + '.';
    }
  }

  // Static hosting: keep the order in this browser and hand it to WhatsApp or email.
  function placeInBrowser(details) {
    const t = D.cart.totals();
    const order = {
      id: D.orders.newId(),
      createdAt: new Date().toISOString(),
      ...details,
      delivery: details.district === 'Dhaka' ? 'Inside Dhaka, charge confirmed by phone' : 'Outside Dhaka, charge confirmed by phone',
      items: D.cart.items().map((i) => ({ id: i.id, sku: i.variant.sku, qty: i.qty, price: D.variantPrice(i.variant), image: i.variant.image })),
      subtotal: t.subtotal,
      unpriced: t.unpriced,
    };
    D.orders.save(order);
    D.cart.clear();
    location.href = `order.html?id=${encodeURIComponent(order.id)}`;
  }
})();
