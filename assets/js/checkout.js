// Checkout: cash on delivery order request, saved in the browser and handed to WhatsApp or email.
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
    const t = D.cart.totals();
    const order = {
      id: D.orders.newId(),
      createdAt: new Date().toISOString(),
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      district: form.district.value,
      area: form.area.value.trim(),
      address: form.address.value.trim(),
      note: form.note.value.trim(),
      payment: form.payment.value,
      delivery: form.district.value === 'Dhaka' ? 'Inside Dhaka, charge confirmed by phone' : 'Outside Dhaka, charge confirmed by phone',
      items: D.cart.items().map((i) => ({ id: i.id, sku: i.variant.sku, qty: i.qty, price: D.variantPrice(i.variant), image: i.variant.image })),
      subtotal: t.subtotal,
      unpriced: t.unpriced,
    };
    D.orders.save(order);
    D.cart.clear();
    location.href = `order.html?id=${encodeURIComponent(order.id)}`;
  });
})();
