// Offices: bulk quote request, plus the deepest stock as proof.
(function () {
  'use strict';
  const D = window.Decoture;
  const deep = D.products.flatMap((p) => p.variants.map((v) => ({ p, v })))
    .filter(({ v }) => v.stock >= 100)
    .sort((a, b) => b.v.stock - a.v.stock)
    .slice(0, 10);
  document.querySelector('[data-deep-stock]').innerHTML = deep.map(({ p, v }) => `
    <a class="stock-row" href="${D.productUrl(p, v)}"><span class="name"><span class="dot" style="--c:${v.swatch}"></span><span>${D.esc(v.sku)}</span></span><span class="value">${Math.floor(v.stock / 100) * 100}+ ready</span></a>`).join('');

  const form = document.querySelector('[data-bulk-form]');
  const err = document.querySelector('[data-form-error]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = ['company', 'name', 'phone', 'items'].map((n) => form[n]).filter((el) => {
      const ok = el.value.trim() !== '';
      el.setAttribute('aria-invalid', String(!ok));
      return !ok;
    });
    if (bad.length) { err.textContent = 'Please fill in the highlighted fields.'; bad[0].focus(); return; }
    err.textContent = '';
    const msg = [
      'Office chair quote request',
      `Company: ${form.company.value.trim()}`,
      `Contact: ${form.name.value.trim()}, ${form.phone.value.trim()}${form.email.value.trim() ? ', ' + form.email.value.trim() : ''}`,
      `Chairs: ${form.items.value.trim()}`,
      `Deliver to: ${form.city.value.trim() || 'Dhaka'}`,
      form.when.value ? `Needed by: ${form.when.value}` : null,
    ].filter(Boolean).join('\n');
    const via = e.submitter ? e.submitter.value : 'whatsapp';
    if (via === 'server') sendToStore();
    else if (via === 'email') location.href = D.mailLink('Office chair quote', msg);
    else D.openExternal(D.whatsappLink(msg));
  });

  // On the live store the request is saved for the sales team; WhatsApp stays as a second way.
  const buttons = form.querySelectorAll('[name="via"]');
  if (D.live) {
    buttons[0].value = 'server'; buttons[0].textContent = 'Send request';
    buttons[1].value = 'whatsapp'; buttons[1].textContent = 'Send on WhatsApp instead';
  }
  async function sendToStore() {
    buttons[0].disabled = true;
    try {
      await D.api('/api/quotes', {
        method: 'POST',
        body: {
          company: form.company.value.trim(), name: form.name.value.trim(), phone: form.phone.value.trim(),
          email: form.email.value.trim(), items: form.items.value.trim(), city: form.city.value.trim() || 'Dhaka', neededBy: form.when.value,
        },
      });
      form.innerHTML = `<div class="note-box"><strong>Thank you.</strong> Our sales team has your request and will call ${D.esc(form.phone.value.trim())} with a quote, usually within one working day.</div>`;
    } catch (ex) {
      buttons[0].disabled = false;
      err.textContent = ex.status ? ex.message : 'We could not reach the store. Try WhatsApp instead, or call us.';
    }
  }
})();
