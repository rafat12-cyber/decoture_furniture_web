// SSLCommerz online payment (bKash, Nagad, Rocket, cards). The customer pays on the SSLCommerz
// page; afterwards SSLCommerz sends them back here and also calls the IPN address. Neither of
// those is trusted on its own: every payment is checked with the validation API before the
// order is marked paid. Docs: https://developer.sslcommerz.com/doc/v4/

const HOSTS = { sandbox: 'https://sandbox.sslcommerz.com', live: 'https://securepay.sslcommerz.com' };

export function createGateway({ storeId, storePassword, live = false, baseUrl, fetchFn = fetch, timeoutMs = 20000 } = {}) {
  const enabled = !!(storeId && storePassword);
  const host = (baseUrl || HOSTS[live ? 'live' : 'sandbox']).replace(/\/$/, '');

  async function call(url, init) {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    try { return JSON.parse(body); } catch { throw new Error(`SSLCommerz answered ${res.status} with something that is not JSON`); }
  }

  return {
    enabled,
    mode: live ? 'live' : 'sandbox',

    // Opens a payment session and returns the page to send the customer to.
    async start({ order, tranId, urls }) {
      const chairs = order.items.reduce((n, i) => n + i.qty, 0);
      const form = new URLSearchParams({
        store_id: storeId,
        store_passwd: storePassword,
        total_amount: order.total.toFixed(2),
        currency: 'BDT',
        tran_id: tranId,
        success_url: urls.success,
        fail_url: urls.fail,
        cancel_url: urls.cancel,
        ipn_url: urls.ipn,
        cus_name: order.name,
        cus_email: order.email || 'customer@decoture.com',
        cus_add1: order.address,
        cus_add2: order.area,
        cus_city: order.district,
        cus_country: 'Bangladesh',
        cus_phone: order.phone,
        shipping_method: 'Courier',
        num_of_item: String(chairs),
        ship_name: order.name,
        ship_add1: `${order.address}, ${order.area}`,
        ship_city: order.district,
        ship_postcode: '1000',
        ship_country: 'Bangladesh',
        product_name: order.items.map((i) => `${i.qty} x ${i.sku}`).join(', ').slice(0, 250),
        product_category: 'Furniture',
        product_profile: 'physical-goods',
        value_a: order.id,
      });
      const data = await call(`${host}/gwprocess/v4/api.php`, { method: 'POST', body: form });
      if (data.status !== 'SUCCESS' || !/^https:\/\//.test(String(data.GatewayPageURL || ''))) {
        throw new Error(`SSLCommerz did not open a payment: ${data.failedreason || data.status || 'no reason given'}`);
      }
      return { url: data.GatewayPageURL };
    },

    // Asks SSLCommerz whether a payment really happened. Returns the checked details or null.
    async validate(valId) {
      if (!valId) return null;
      const qs = new URLSearchParams({ val_id: valId, store_id: storeId, store_passwd: storePassword, v: '1', format: 'json' });
      const data = await call(`${host}/validator/api/validationserverAPI.php?${qs}`, { method: 'GET' });
      if (data.status !== 'VALID' && data.status !== 'VALIDATED') return null;
      return {
        tranId: String(data.tran_id || ''),
        valId: String(data.val_id || valId),
        currency: String(data.currency_type || data.currency || ''),
        amount: Number(data.currency_amount ?? data.amount),
        method: String(data.card_issuer || data.card_type || '').trim(),
        bankTranId: String(data.bank_tran_id || ''),
        risky: String(data.risk_level) === '1',
      };
    },
  };
}
