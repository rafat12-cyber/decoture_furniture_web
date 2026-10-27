// Order confirmation. Live store: the order is already with the team, so show its status, its
// payment and a tracking link; an unpaid online order can be paid again or switched to cash.
// Static host: one tap sends the order to the Decoture team.
(function () {
  'use strict';
  const D = window.Decoture;
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  let order = id ? D.orders.get(id) : D.orders.all()[0];
  const root = document.querySelector('[data-order]');
  if (!order) {
    document.querySelector('[data-order-title]').textContent = 'Order not found';
    root.innerHTML = `<p>We could not find that order in this browser.</p><div class="actions">${D.live ? `<a class="button" href="track.html${id ? `?id=${encodeURIComponent(id)}` : ''}">Track an order</a>` : ''}<a class="button${D.live ? ' button--ghost' : ''}" href="shop.html">Browse chairs</a></div>`;
    return;
  }
  document.querySelector('[data-order-title]').textContent = `Thank you, ${order.name.split(' ')[0]}`;
  document.querySelector('[data-order-id]').textContent = `Order ${order.id}`;
  const trackUrl = `track.html?id=${encodeURIComponent(order.id)}`;
  // What the gateway said on the way back, until the server's answer arrives.
  const returned = params.get('payment');

  function head(o) {
    if (!o.server) {
      const msg = D.orders.message(o);
      return `<div class="note-box"><strong>One last step:</strong> send the order to our team so we can call you to confirm it.</div>
       <div class="actions">
         <a class="button" href="${D.whatsappLink(msg)}" target="_blank" rel="noopener">Send order on WhatsApp</a>
         <a class="button button--ghost" href="${D.mailLink(`Order ${o.id}`, msg)}">Send by email</a>
       </div>`;
    }
    const status = `Status: <strong data-order-status>${D.esc(D.STATUS_LABELS[o.status] || 'Received')}</strong>`;
    const unpaid = (o.paymentStatus === 'pending' || o.paymentStatus === 'failed') && o.status !== 'cancelled';
    if (unpaid) {
      const why = returned === 'cancelled' ? 'You left the payment page before paying.' : returned === 'failed' || o.paymentStatus === 'failed' ? 'The payment did not go through.' : 'We are waiting for your payment.';
      return `<div class="note-box note-box--warn"><strong>${why}</strong> Your chairs are held for 24 hours. You can try again, or pay in cash when they arrive.</div>
       <p class="error-text" data-pay-error role="alert"></p>
       <div class="actions">
         <button class="button" type="button" data-pay-again>Pay online again</button>
         <button class="button button--ghost" type="button" data-pay-cash>Pay cash on delivery instead</button>
       </div>`;
    }
    const paid = o.paymentStatus === 'paid'
      ? `<strong>Payment received.</strong> Thank you, we have your payment of ${D.money(o.total)}. We will call you on ${D.esc(o.phone)} to book the delivery.`
      : `<strong>We have your order.</strong> Our team will call you on ${D.esc(o.phone)} to confirm it.`;
    return `<div class="note-box">${paid} ${status}</div>
       <div class="actions">
         <a class="button" href="${trackUrl}">Track this order</a>
         <a class="button button--ghost" href="${D.whatsappLink(`Hello Decoture, I just placed order ${o.id}.`)}" target="_blank" rel="noopener">Message us on WhatsApp</a>
       </div>`;
  }

  function render(o) {
    const paid = o.paymentStatus === 'paid';
    root.innerHTML = `
    ${head(o)}
    <section class="summary" aria-labelledby="o-sum" style="position:static">
      <h2 id="o-sum">Order summary</h2>
      <div>${o.items.map((i) => `
        <div class="line-item" style="grid-template-columns:56px 1fr auto">
          <div class="thumb" style="width:56px;height:68px"><img src="${i.image || D.PLACEHOLDER}" alt="" style="max-height:62px"></div>
          <div><h3>${D.esc(i.sku)}</h3><p class="meta">Qty ${i.qty}</p></div>
          <div class="line-total">${i.price == null ? '' : D.money(i.price * i.qty)}</div>
        </div>`).join('')}</div>
      <div class="totals">
        <div><span>Subtotal</span><span>${D.money(o.subtotal)}${o.unpriced ? ' +' : ''}</span></div>
        <div><span>Delivery <small class="soft">${D.esc(o.delivery)}</small></span><span>${o.deliveryFee == null ? '' : o.deliveryFee ? D.money(o.deliveryFee) : 'Free'}</span></div>
        ${o.total != null ? `<div class="grand"><span>Total</span><span>${D.money(o.total)}${o.unpriced ? ' +' : ''}</span></div>` : ''}
        <div><span>Payment</span><span>${D.esc(D.paymentLabel(o))}</span></div>
      </div>
      <p class="small soft">Deliver to ${D.esc(o.name)}, ${D.esc(o.phone)}<br>${D.esc(o.address)}, ${D.esc(o.area)}, ${D.esc(o.district)}</p>
    </section>
    <section aria-labelledby="next-title">
      <h2 class="section-heading" id="next-title" style="margin-bottom:20px">What happens next</h2>
      <ol class="steps">
        <li>Our team calls you on ${D.esc(o.phone)} to confirm the chairs and the delivery date.</li>
        <li>Your chairs are packed with their warranty card.</li>
        <li>${paid ? 'They arrive at your door. There is nothing more to pay.' : o.payment === 'Online payment' ? 'Once your payment is through, they are on their way.' : 'You pay in cash when they arrive.'}</li>
      </ol>
    </section>
    <div class="actions"><a class="link" href="shop.html">Keep shopping</a></div>`;
    bind(o);
  }

  function bind(o) {
    const again = root.querySelector('[data-pay-again]');
    const cash = root.querySelector('[data-pay-cash]');
    const err = root.querySelector('[data-pay-error]');
    if (!again) return;
    const busy = (on) => { again.disabled = on; cash.disabled = on; };
    again.hidden = !D.onlinePayment;
    again.addEventListener('click', async () => {
      busy(true); err.textContent = '';
      try {
        const { payUrl } = await D.api(`/api/orders/${encodeURIComponent(o.id)}/pay`, { method: 'POST', body: { phone: o.phone } });
        location.href = payUrl;
      } catch (e) { busy(false); err.textContent = e.message; }
    });
    cash.addEventListener('click', async () => {
      busy(true); err.textContent = '';
      try {
        const { order: fresh } = await D.api(`/api/orders/${encodeURIComponent(o.id)}/cash`, { method: 'POST', body: { phone: o.phone } });
        update(fresh);
        D.toast('Done. You will pay in cash when the chairs arrive.');
      } catch (e) { busy(false); err.textContent = e.message; }
    });
  }

  function update(fresh) {
    order = { ...order, ...fresh, server: true };
    D.orders.save(order);
    render(order);
  }

  render(order);

  // Refresh from the store: the team may have confirmed it, or the payment may have just landed.
  if (order.server && D.live) {
    D.api(`/api/orders/${encodeURIComponent(order.id)}?phone=${encodeURIComponent(order.phone)}`)
      .then(({ order: fresh }) => update(fresh))
      .catch(() => {});
  }
})();
