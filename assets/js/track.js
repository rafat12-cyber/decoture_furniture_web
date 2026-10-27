// Order tracking: order number plus the phone it was placed with.
(function () {
  'use strict';
  const D = window.Decoture;
  const form = document.querySelector('[data-track-form]');
  const err = document.querySelector('[data-form-error]');
  const out = document.querySelector('[data-track-result]');
  const STEPS = ['new', 'confirmed', 'shipped', 'delivered'];
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' });

  if (!D.live) {
    form.innerHTML = `<p>Order tracking works on the live store. To check an order, call us on <a href="${D.CONFIG.phoneHref}">${D.CONFIG.phone}</a> or <a href="${D.whatsappLink('Hello Decoture, I would like to check my order.')}" target="_blank" rel="noopener">message us on WhatsApp</a>.</p>`;
    return;
  }

  // Prefill from the link and from an order placed in this browser.
  const id = new URLSearchParams(location.search).get('id');
  if (id) {
    form.id.value = id;
    const mine = D.orders.get(id);
    if (mine) form.phone.value = mine.phone;
  }

  function render(o) {
    const at = STEPS.indexOf(o.status);
    const cancelled = o.status === 'cancelled';
    const notes = o.events.filter((e) => e.note && e.note !== 'Order placed on the website');
    out.hidden = false;
    out.innerHTML = `
      <h2>Order ${D.esc(o.id)}</h2>
      <p class="track-status track-status--${D.esc(o.status)}">${D.esc(D.STATUS_LABELS[o.status] || o.status)}</p>
      ${cancelled
        ? '<p class="soft">This order was cancelled. If that is a surprise, please call us.</p>'
        : `<ol class="track-steps">${STEPS.map((s, i) => {
          const ev = o.events.filter((e) => e.status === s).pop();
          return `<li class="${i <= at ? 'is-done' : ''}${i === at ? ' is-current' : ''}"><span>${D.STATUS_LABELS[s]}</span>${ev ? `<small>${when(ev.at)}</small>` : ''}</li>`;
        }).join('')}</ol>`}
      ${notes.length ? `<div class="track-notes">${notes.map((e) => `<p><small class="soft">${when(e.at)}</small><br>${D.esc(e.note)}</p>`).join('')}</div>` : ''}
      <div>${o.items.map((i) => `<p class="track-line"><span>${i.qty} × ${D.esc(i.sku)}</span><span>${i.price == null ? '' : D.money(i.price * i.qty)}</span></p>`).join('')}</div>
      <div class="totals">
        <div><span>Subtotal</span><span>${D.money(o.subtotal)}${o.unpriced ? ' +' : ''}</span></div>
        <div><span>Delivery <small class="soft">${D.esc(o.delivery)}</small></span><span>${o.deliveryFee ? D.money(o.deliveryFee) : 'Free'}</span></div>
        <div class="grand"><span>Total</span><span>${D.money(o.total)}${o.unpriced ? ' +' : ''}</span></div>
        <div><span>Payment</span><span>${D.esc(D.paymentLabel(o))}</span></div>
      </div>
      </div>
      ${(o.paymentStatus === 'pending' || o.paymentStatus === 'failed') && !cancelled ? `
      <div class="note-box note-box--warn"><strong>This order is not paid yet.</strong> Pay online again, or pay in cash when the chairs arrive.</div>
      <p class="error-text" data-pay-error role="alert"></p>
      <div class="actions">
        ${D.onlinePayment ? '<button class="button" type="button" data-pay-again>Pay online again</button>' : ''}
        <button class="button button--ghost" type="button" data-pay-cash>Pay cash on delivery instead</button>
      </div>` : ''}
      <p class="small soft">Placed ${when(o.createdAt)} · delivering to ${D.esc(o.area)}, ${D.esc(o.district)}</p>`;
  }

  // Unpaid online orders: open a new payment, or switch to cash on delivery.
  out.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pay-again], [data-pay-cash]');
    if (!btn) return;
    const oid = form.id.value.trim().toUpperCase();
    const body = { phone: form.phone.value.trim() };
    const err = out.querySelector('[data-pay-error]');
    btn.disabled = true; err.textContent = '';
    try {
      if (btn.matches('[data-pay-again]')) {
        const { payUrl } = await D.api(`/api/orders/${encodeURIComponent(oid)}/pay`, { method: 'POST', body });
        location.href = payUrl;
      } else {
        const { order } = await D.api(`/api/orders/${encodeURIComponent(oid)}/cash`, { method: 'POST', body });
        render(order);
      }
    } catch (ex) { btn.disabled = false; err.textContent = ex.message; }
  });

  async function lookup() {
    const oid = form.id.value.trim().toUpperCase();
    const phone = form.phone.value.trim();
    form.id.setAttribute('aria-invalid', String(!oid));
    form.phone.setAttribute('aria-invalid', String(!phone));
    if (!oid || !phone) { err.textContent = 'Please enter both the order number and your mobile number.'; return; }
    err.textContent = '';
    try {
      const { order } = await D.api(`/api/orders/${encodeURIComponent(oid)}?phone=${encodeURIComponent(phone)}`);
      render(order);
    } catch (e) {
      out.hidden = true;
      err.textContent = e.status ? e.message : 'We could not reach the store. Please try again.';
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); lookup(); });
  if (form.id.value && form.phone.value) lookup();
})();
