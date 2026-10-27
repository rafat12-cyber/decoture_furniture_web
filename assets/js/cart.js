// Cart page.
(function () {
  'use strict';
  const D = window.Decoture;
  const lines = document.querySelector('[data-cart-lines]');
  const totals = document.querySelector('[data-cart-totals]');
  const checkout = document.querySelector('[data-checkout-link]');
  D.bindLineItems(lines);
  function render() {
    if (!D.cart.count()) {
      lines.innerHTML = `<div class="drawer-empty"><p class="lead">Your cart is empty.</p><a class="button" href="shop.html">Browse all chairs</a></div>`;
      totals.innerHTML = '';
      checkout.hidden = true;
      return;
    }
    checkout.hidden = false;
    lines.innerHTML = D.lineItemsHTML();
    totals.innerHTML = D.totalsHTML();
  }
  D.cart.subscribe(render);
  render();
})();
