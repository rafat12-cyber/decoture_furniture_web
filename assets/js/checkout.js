// Checkout: cash on delivery, or online payment through SSLCommerz when the store has it set up.
// On the live store the order goes to the server; on a static host it is saved in the browser and
// handed to WhatsApp or email.
(function () {
  'use strict';
  const D = window.Decoture;
  const form = document.querySelector('[data-checkout-form]');
  const err = document.querySelector('[data-form-error]');
  const linesBox = document.querySelector('[data-checkout-lines]');
  const totals = document.querySelector('[data-cart-totals]');

  if (!D.cart.count()) { location.replace('cart.html'); return; }

  form.district.insertAdjacentHTML('beforeend', D.districts.map((d) => `<option>${D.esc(d)}</option>`).join(''));
  form.district.value = 'Dhaka';
  form.district.addEventListener('change', renderSummary);

  // Online payment is offered when the server has SSLCommerz set up and every chair has a price.
  const onlineCard = document.querySelector('[data-online-card]');
  const submit = form.querySelector('[data-submit]');
  const submitNote = document.querySelector('[data-submit-note]');
  function renderPayment() {
    const input = onlineCard.querySelector('input');
    const unpriced = D.cart.totals().unpriced > 0;
    input.disabled = !D.onlinePayment || unpriced;
    if (input.disabled && input.checked) form.payment.value = 'Cash on delivery';
    onlineCard.querySelector('[data-online-note]').textContent = !D.onlinePayment
      ? 'Online payment is coming soon.'
      : unpriced ? 'Some chairs are priced on request, so please pay on delivery.' : 'Pay now on the secure SSLCommerz page.';
    onlineCard.querySelector('[data-online-tag]').hidden = D.onlinePayment && !unpriced;
    const online = form.payment.value === 'Online payment';
    submit.textContent = online ? 'Continue to payment' : 'Place order';
    submitNote.textContent = online
      ? 'You will pay on the SSLCommerz page with bKash, Nagad, Rocket or a card, then come back here.'
      : 'By placing the order you agree that our team may call you to confirm it. Nothing is charged online.';
  }
  if (D.onlinePayment) document.querySelector('[data-checkout-lead]').textContent = 'Pay in cash when your chairs arrive, or online now with bKash, Nagad, Rocket or a card.';
  form.addEventListener('change', (e) => { if (e.target.name === 'payment') renderPayment(); });

  function renderSummary() {
    linesBox.innerHTML = D.cart.items().map((i) => `
      <div class="line-item" style="grid-template-columns:56px 1fr auto">
        <div class="thumb" style="width:56px;height:68px"><img src="${i.variant.image || D.PLACEHOLDER}" alt="" style="max-height:62px"></div>
        <div><h3>${D.esc(i.product.name)}</h3><p class="meta">${D.esc(i.variant.colour)} · Qty ${i.qty}</p></div>
        <div class="line-total">${D.variantPrice(i.variant) == null ? '' : D.money(D.variantPrice(i.variant) * i.qty)}</div>
      </div>`).join('');
    totals.innerHTML = D.totalsHTML(form.district.value || 'Dhaka');
    renderPayment();
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
  // For online payment it also opens an SSLCommerz session, and the customer goes there next.
  async function placeOnServer(details) {
    submit.disabled = true;
    submit.textContent = details.payment === 'Online payment' ? 'Opening the payment page…' : 'Placing your order…';
    try {
      const { order, payUrl } = await D.api('/api/orders', {
        method: 'POST',
        body: { ...details, items: D.cart.items().map((i) => ({ id: i.id, qty: i.qty })) },
      });
      D.orders.save({ ...details, ...order, server: true });
      D.cart.clear();
      if (payUrl) { location.href = payUrl; return; }
      location.href = `order.html?id=${encodeURIComponent(order.id)}${order.paymentStatus === 'failed' ? '&payment=failed' : ''}`;
    } catch (e) {
      submit.disabled = false;
      renderPayment();
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
    const d = D.deliveryFor(details.district, t.count, t.subtotal);
    const order = {
      id: D.orders.newId(),
      createdAt: new Date().toISOString(),
      ...details,
      delivery: `${d.zone.name}${d.zone.days ? `, ${d.zone.days}` : ''}${d.free ? ', free delivery' : ''}`,
      deliveryFee: d.fee,
      total: t.subtotal + d.fee,
      items: D.cart.items().map((i) => ({ id: i.id, sku: i.variant.sku, qty: i.qty, price: D.variantPrice(i.variant), image: i.variant.image })),
      subtotal: t.subtotal,
      unpriced: t.unpriced,
    };
    D.orders.save(order);
    D.cart.clear();
    location.href = `order.html?id=${encodeURIComponent(order.id)}`;
  }
})();
