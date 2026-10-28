// Catalog shape shared by the static build (tools/build-catalog.mjs) and the server.
// Input rows look like data/stock.csv rows; output is what assets/js/catalog.js holds.

export const COLLECTIONS = {
  executive: {
    name: 'Executive',
    blurb: 'High-back upholstered chairs for directors, cabins and home studies.',
    describe: (p) => `${p.name} is a high-back upholstered executive chair with imported fittings throughout.`,
  },
  ergonomic: {
    name: 'Ergonomic',
    blurb: 'Supportive high-back chairs for long days at a desk.',
    describe: (p) => `${p.name} is an ergonomic high-back chair built for long working days, with imported fittings throughout.`,
  },
  task: {
    name: 'Task & office',
    blurb: 'Mid-back mesh chairs for teams, workstations and meeting rooms.',
    describe: (p) => `${p.name} is a mesh task chair for workstations and teams, with imported fittings throughout.`,
  },
  conference: {
    name: 'Conference & visitor',
    blurb: 'Leather boardroom chairs and sled-base visitor chairs for meeting rooms and reception.',
    describe: (p) => `${p.name} is a conference and visitor chair for boardrooms, meeting rooms and reception areas.`,
  },
  training: {
    name: 'Training',
    blurb: 'Stackable and folding chairs, some with a writing tablet, for classrooms and training rooms.',
    describe: (p) => `${p.name} is a training chair for classrooms, seminar and training rooms.`,
  },
};

// Approximate swatch colours for the colour names used in the stock list.
export const SWATCH = {
  silver: '#a9adb0', sand: '#c99a6b', ash: '#8d8c88', peach: '#e6c3a3', iron: '#5b4b48',
  'falk white': '#ece6da', black: '#1d1d1f', 'pearl white': '#efece4', bronze: '#a0603e',
  grey: '#8f9396', green: '#2f6b55', orange: '#d0603a', red: '#9e3434', blue: '#2f5d8a',
  khaki: '#a8996e', 'full black': '#111214', white: '#f2f2f0', brown: '#8a5232',
  'full mesh': '#6c6f73', 'grey / blue': '#4f7fae', 'black / green seat': '#2f6b55',
  'full grey': '#7d8184', 'white / black': '#d9d9d6', 'grey / green': '#4f7a68', tan: '#b9814f',
  'pvc base': '#6b4630', 'chrome base': '#b8bcbf',
};

// A collection name for each model; the site shows it with the model number, e.g. "Monarch 6801A".
// High-back (A) and mid-back (B) versions of the same chair share a name.
export const NAMES = {
  '6801A': 'Monarch', '6801B': 'Monarch', '6856A': 'Sovereign', '6838A': 'Regent', '6859A': 'Chancellor',
  '6832A': 'Ambassador', '6833A': 'Senator', '6837A': 'Baron', '6995A': 'Marquis',
  'GMC-5D': 'Apex', A15: 'Zenith', A12: 'Orion', A676: 'Vector', A22: 'Atlas', A21: 'Aria', A31: 'Nova',
  A821: 'Luna', B821: 'Luna', 'A3903-1': 'Vela', 'B3903-1': 'Vela', A03: 'Flex', B03: 'Flex',
  A10: 'Sola', B10: 'Sola', A7901: 'Helix', A3905: 'Arc', A7905: 'Strata', B7905: 'Strata', A01: 'Prime',
  A3004: 'Linea', B3004: 'Linea',
  'C-2013T': 'Metro', 'C-2013': 'Metro', 'C-108': 'Civic', 'C-805': 'Pace', 'C-337': 'Ellis', 'C-277': 'Hart',
  'C-699': 'Quinn', 'C-2311': 'Brio', 'C-2301': 'Nimbus', 'C-286': 'Rowan', 'C-758': 'Sterling', 'C-687': 'Kent',
  'C-622': 'Mason', 'C-323': 'Ivy',
  'CDS-155 L': 'Belmont', 'CDS-155 M': 'Belmont', 'CFV-152 R': 'Windsor',
  D113: 'Scholar', 'FCR-109': 'Campus', 'FCR-110': 'Forum', 'FCR-111': 'Lyceum',
};

export const displayName = (model) => (NAMES[model] ? `${NAMES[model]} ${model}` : String(model));

export const STOCK_LIST_DATE = '2026-10-27';

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = (s) => (s === '' || s == null ? null : Number(s));

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

export const swatchFor = (colour) => SWATCH[String(colour).toLowerCase()] ?? '#888888';

// rows: { sl, code, model, colour, collection, stock, warranty_years, features, image, price_bdt,
// sale_price_bdt, gallery?, swatch? }. image is a file name in assets/img/products/ or a site path;
// gallery lists more photos of the same chair (other angles), separated by |.
export function buildCatalog(rows) {
  const products = new Map();
  for (const r of rows) {
    const key = slug(r.model);
    if (!products.has(key)) {
      products.set(key, {
        slug: key,
        model: r.model,
        collection: r.collection,
        warrantyYears: num(r.warranty_years),
        features: new Set(),
        variants: [],
      });
    }
    const p = products.get(key);
    if (r.features) p.features.add(r.features);
    const path = (f) => (f.includes('/') ? f : `assets/img/products/${f}`);
    const image = r.image ? path(r.image) : null;
    const extra = String(r.gallery || '').split('|').map((f) => f.trim()).filter(Boolean).map(path);
    p.variants.push({
      sku: `${r.model} ${r.colour}`,
      code: r.code || '',
      id: slug(`${r.model}-${r.colour}`),
      colour: r.colour,
      swatch: r.swatch || swatchFor(r.colour),
      stock: num(r.stock) ?? 0,
      image,
      gallery: image ? [image, ...extra] : extra,
      price: num(r.price_bdt),
      salePrice: num(r.sale_price_bdt),
      sl: num(r.sl),
    });
  }
  const list = [...products.values()].map((p) => {
    const name = displayName(p.model);
    return {
      ...p,
      features: [...p.features],
      name,
      description: (COLLECTIONS[p.collection] || COLLECTIONS.executive).describe({ ...p, name }),
    };
  });
  return {
    stockListDate: STOCK_LIST_DATE,
    collections: Object.fromEntries(Object.entries(COLLECTIONS).map(([k, v]) => [k, { name: v.name, blurb: v.blurb }])),
    products: list,
  };
}

export function catalogScript(catalog, header = 'Generated by tools/build-catalog.mjs from data/stock.csv. Do not edit by hand.') {
  return `// ${header}\nwindow.DECOTURE_CATALOG = ${JSON.stringify(catalog, null, 1)};\n`;
}
