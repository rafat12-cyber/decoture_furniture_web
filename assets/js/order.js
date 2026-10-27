// Order confirmation. Live store: the order is already with the team, so show its status and a
// tracking link. Static host: one tap sends the order to the Decoture team.
(function () {
  'use strict';
  const D = window.Decoture;
  const id = new URLSearchParams(location.search).get('id');
  const order = id ? D.orders.get(id) : D.orders.all()[0];
  const root = document.querySelector('[data-order]');
  if (!order) {
    document.querySelector('[data-order-title]').textContent = 'Order not found';
    root.innerHTML = `<p>We could not find that order in this browser.</p><div class="actions">${D.live ? '<a class="button" href="track.html">Track an order</a>' : ''}<a class="button${D.live ? ' button--ghost' : ''}" href="shop.html">Browse chairs</a></div>`;
    return;
  }
  document.querySelector('[data-order-title]').textContent = `Thank you, ${order.name.split(' ')[0]}`;
  document.querySelector('[data-order-id]').textContent = `Order ${order.id}`;
  const msg = D.orders.message(order);
  const trackUrl = `track.html?id=${encodeURIComponent(order.id)}`;
  const head = order.server
    ? `<div class="note-box"><strong>We have your order.</strong> Our team will call you on ${D.esc(order.phone)} to confirm it. Status: <strong data-order-status>${D.esc(D.STATUS_LABELS[order.status] || 'Received')}</strong></div>
       <div class="actions">
         <a class="button" href="${trackUrl}">Track this order</a>
         <a class="button button--ghost" href="${D.whatsappLink(`Hello Decoture, I just placed order ${order.id}.`)}" target="_blank" rel="noopener">Message us on WhatsApp</a>
       </div>`
    : `<div class="note-box"><strong>One last step:</strong> send the order to our team so we can call you to confirm it.</div>
       <div class="actions">
         <a class="button" href="${D.whatsappLink(msg)}" target="_blank" rel="noopener">Send order on WhatsApp</a>
         <a class="button button--ghost" href="${D.mailLink(`Order ${order.id}`, msg)}">Send by email</a>
       </div>`;
  root.innerHTML = `
    ${head}
    <section class="summary" aria-labelledby="o-sum" style="position:static">
      <h2 id="o-sum">Order summary</h2>
      <div>${order.items.map((i) => `
        <div class="line-item" style="grid-template-columns:56px 1fr auto">
          <div class="thumb" style="width:56px;height:68px"><img src="${i.image || D.PLACEHOLDER}" alt="" style="max-height:62px"></div>
          <div><h3>${D.esc(i.sku)}</h3><p class="meta">Qty ${i.qty}</p></div>
          <div class="line-total">${i.price == null ? '' : D.money(i.price * i.qty)}</div>
        </div>`).join('')}</div>
      <div class="totals">
        <div><span>Subtotal</span><span>${D.money(order.subtotal)}${order.unpriced ? ' +' : ''}</span></div>
        <div><span>Delivery</span><span class="soft">${D.esc(order.delivery)}</span></div>
        <div><span>Payment</span><span>${D.esc(order.payment)}</span></div>
      </div>
      <p class="small soft">Deliver to ${D.esc(order.name)}, ${D.esc(order.phone)}<br>${D.esc(order.address)}, ${D.esc(order.area)}, ${D.esc(order.district)}</p>
    </section>
    <section aria-labelledby="next-title">
      <h2 class="section-heading" id="next-title" style="margin-bottom:20px">What happens next</h2>
      <ol class="steps">
        <li>Our team calls you on ${D.esc(order.phone)} to confirm the chairs, the delivery charge and the date.</li>
        <li>Your chairs are packed with their warranty card.</li>
        <li>You pay in cash when they arrive.</li>
      </ol>
    </section>
    <div class="actions"><a class="link" href="shop.html">Keep shopping</a></div>`;

  // Refresh the status from the store, in case the team has already confirmed it.
  if (order.server && D.live) {
    D.api(`/api/orders/${encodeURIComponent(order.id)}?phone=${encodeURIComponent(order.phone)}`)
      .then(({ order: o }) => {
        const el = root.querySelector('[data-order-status]');
        if (el) el.textContent = D.STATUS_LABELS[o.status] || o.status;
      })
      .catch(() => {});
  }
})();
