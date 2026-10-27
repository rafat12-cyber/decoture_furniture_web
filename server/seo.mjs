// Search and sharing: robots.txt, sitemap.xml, and the tags added to each page's <head> as it is
// served (canonical address, Open Graph, structured data). Product pages are built in the browser,
// so the server writes their title, description and Product data into the HTML for crawlers.

const PAGES = ['', 'shop.html', 'offices.html', 'about.html', 'contact.html'];
const PRIVATE = ['cart.html', 'checkout.html', 'order.html', 'track.html'];
const DEFAULT_IMAGE = 'assets/img/brand/catalogue.jpg';
const BUSINESS = {
  name: 'DECOTURE',
  parent: 'Sigma Synchrony',
  phone: '+880 1791 978775',
  street: '57/60, Uttar Senpara Parbata 11, Mirpur',
  city: 'Dhaka',
  postcode: '1216',
};

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const price = (v) => (v.salePrice != null ? v.salePrice : v.price);

export function robotsTxt(base) {
  return [
    'User-agent: *',
    'Disallow: /admin/',
    'Disallow: /api/',
    ...PRIVATE.map((p) => `Disallow: /${p}`),
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(base, catalog, lastmod) {
  const day = (lastmod || new Date().toISOString()).slice(0, 10);
  const urls = [
    ...PAGES.map((p) => `${base}/${p}`),
    ...Object.keys(catalog.collections).map((c) => `${base}/shop.html?collection=${c}`),
    ...catalog.products.map((p) => `${base}/product.html?m=${encodeURIComponent(p.slug)}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${xml(u)}</loc><lastmod>${day}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

function productHead(base, catalog, slug) {
  const p = catalog.products.find((x) => x.slug === slug);
  if (!p) return null;
  const coll = catalog.collections[p.collection] || { name: 'Office' };
  const prices = p.variants.map(price).filter((n) => n != null);
  const images = p.variants.flatMap((v) => v.gallery || [v.image]).filter(Boolean).map((i) => `${base}/${i}`);
  const inStock = p.variants.some((v) => v.stock > 0);
  const colours = p.variants.map((v) => v.colour).join(', ');
  const description = `${p.description} ${p.variants.length > 1 ? `In ${colours}.` : ''} ${prices.length ? `From ৳${Math.min(...prices).toLocaleString('en-IN')}.` : ''} Cash on delivery in Bangladesh.`.replace(/\s+/g, ' ').trim();
  return {
    title: `${p.name} ${coll.name} chair · DECOTURE – A brand of Sigma Synchrony`,
    description,
    image: images[0] || `${base}/${DEFAULT_IMAGE}`,
    type: 'product',
    data: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${p.name} ${coll.name} chair`,
      sku: p.model,
      description: p.description,
      brand: { '@type': 'Brand', name: 'Decoture' },
      category: `${coll.name} chairs`,
      image: images.length ? images : undefined,
      color: colours,
      offers: prices.length ? {
        '@type': 'AggregateOffer',
        priceCurrency: 'BDT',
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: p.variants.length,
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${base}/product.html?m=${encodeURIComponent(p.slug)}`,
      } : undefined,
    },
  };
}

const storeData = (base) => ({
  '@context': 'https://schema.org',
  '@type': 'FurnitureStore',
  name: BUSINESS.name,
  parentOrganization: { '@type': 'Organization', name: BUSINESS.parent },
  url: `${base}/`,
  logo: `${base}/assets/img/logo/lockup.svg`,
  image: `${base}/assets/img/brand/showroom-sign.jpg`,
  telephone: BUSINESS.phone,
  priceRange: '৳৳',
  address: { '@type': 'PostalAddress', streetAddress: BUSINESS.street, addressLocality: BUSINESS.city, postalCode: BUSINESS.postcode, addressCountry: 'BD' },
  areaServed: 'BD',
  paymentAccepted: 'Cash, bKash, Nagad, Credit Card',
  currenciesAccepted: 'BDT',
});

// Adds the tags to a page as it is served. `page` is the file name, `query` the URL's search params.
export function decorateHtml(html, { base, page, query, catalog }) {
  const titleMatch = /<title>([^<]*)<\/title>/.exec(html);
  const descMatch = /<meta name="description" content="([^"]*)">/.exec(html);
  // Text read from the page is already HTML-escaped; text from the catalog is escaped on output.
  const unescape = (t) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let title = titleMatch ? unescape(titleMatch[1]) : 'DECOTURE – A brand of Sigma Synchrony';
  let description = descMatch ? unescape(descMatch[1]) : '';
  let image = `${base}/${DEFAULT_IMAGE}`;
  let type = 'website';
  let path = page === 'index.html' ? '' : page;
  const extra = [];

  if (page === 'product.html') {
    const head = productHead(base, catalog, query.get('m'));
    if (head) {
      ({ title, description, image, type } = head);
      path = `product.html?m=${encodeURIComponent(query.get('m'))}`;
      extra.push(jsonLd(head.data));
    }
  }
  if (page === 'shop.html' && catalog.collections[query.get('collection')]) {
    const c = catalog.collections[query.get('collection')];
    title = `${c.name} chairs · DECOTURE – A brand of Sigma Synchrony`;
    description = `${c.blurb} Imported ${c.name.toLowerCase()} chairs from Decoture in Dhaka, with cash on delivery.`;
    path = `shop.html?collection=${query.get('collection')}`;
  }
  if (page === 'index.html') extra.push(jsonLd(storeData(base)));

  const url = `${base}/${path}`;
  const tags = [
    PRIVATE.includes(page) ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${attr(url)}">`,
    '<meta property="og:site_name" content="DECOTURE – A brand of Sigma Synchrony">',
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    description ? `<meta property="og:description" content="${attr(description)}">` : '',
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    '<meta property="og:locale" content="en_BD">',
    '<meta name="twitter:card" content="summary_large_image">',
    ...extra,
  ].filter(Boolean).join('\n  ');

  let out = html;
  if (titleMatch) out = out.replace(titleMatch[0], () => `<title>${attr(title)}</title>`);
  if (descMatch) out = out.replace(descMatch[0], () => `<meta name="description" content="${attr(description)}">`);
  return out.replace('</head>', () => `  ${tags}\n</head>`);
}
