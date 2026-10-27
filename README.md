# Decoture storefront

The online shop for **Decoture**, a contemporary furniture and lifestyle brand in Dhaka. Phase 1 sells the imported chair range from the stock list of 20 October 2026: 56 models in 92 colourways.

It is a static site in plain HTML, CSS and JavaScript, with no framework and no build step to serve it. Any static host works: Netlify, Vercel, Cloudflare Pages, GitHub Pages or ordinary cPanel hosting.

## Pages

| Page | File |
|---|---|
| Home (contact-sheet hero, executive line, stock, warranty, quote bar) | `index.html` |
| Shop with collection, colour and in-stock filters | `shop.html` |
| Product with colour variants, stock and add to cart | `product.html?m=<model>&c=<variant>` |
| Cart (also a slide-out drawer on every page) | `cart.html` |
| Checkout, cash on delivery | `checkout.html` |
| Order confirmation, sends the order on WhatsApp or by email | `order.html` |
| Bulk quotes for offices | `offices.html` |
| About, Showroom and contact | `about.html`, `contact.html` |

## Run it locally

```sh
npx http-server -p 8080      # or: python3 -m http.server 8080
```

Then open http://localhost:8080.

## Updating products, stock and prices

All product data lives in `data/stock.csv`, one row per colourway:

| Column | Meaning |
|---|---|
| `model`, `colour` | Rows with the same model become one product with colour options |
| `collection` | `executive`, `ergonomic`, `task` or `training` |
| `stock` | Units in the warehouse. 10 or fewer shows "Only N left"; 0 shows "Out of stock" |
| `warranty_years` | 2 for most chairs, 1 for CDS conference chairs |
| `image` | File name in `assets/img/products/`, or empty for "photo coming soon" |
| `price_bdt`, `sale_price_bdt` | Price in taka. A sale price shows the regular price struck through |

After editing the CSV, regenerate the catalog:

```sh
node tools/build-catalog.mjs
```

Every chair is currently priced at ৳8,900 as a placeholder.

## Orders

Phase 1 has no server. Checkout saves the order in the customer's browser and the confirmation page sends it to Decoture on WhatsApp (+880 1791 978775) or by email. The number and email address live in `CONFIG` at the top of `assets/js/app.js`.

## Brand

Colours and type come from the Decoture brand guidelines: Signature Gold `#D4AF37`, Warm Bronze `#C5A059`, Deep Charcoal `#1C2321`, and DM Sans. The logo files in `assets/img/logo/` were taken from the guideline artwork. Brand photographs in `assets/img/brand/` are from the same document.

## Next phases

1. Next.js with a database and an admin panel for products, prices, stock and orders.
2. Online payment through SSLCommerz (bKash, Nagad, cards), delivery zones and charges, SEO and analytics.
3. More categories: furniture, décor, gaming, and interior design enquiries.
