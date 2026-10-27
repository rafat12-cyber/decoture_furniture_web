# Decoture store

The online shop for **Decoture**, a contemporary furniture and lifestyle brand in Dhaka. It sells the imported chair range from the stock list of 20 October 2026: 56 models in 92 colourways.

It has three parts:

- **The storefront.** Plain HTML, CSS and JavaScript, with a scroll-driven 3D chair on the home page.
- **A small Node.js server.** It keeps products, prices, stock, orders and office quote requests in a SQLite database, and checks prices and stock itself when an order comes in.
- **An admin panel** at `/admin` for the Decoture team.

There are no packages to install. You only need Node.js 22.5 or newer.

## Run it locally

```sh
ADMIN_PASSWORD='choose-a-long-password' npm start
```

Open http://localhost:8080 for the store and http://localhost:8080/admin for the admin panel (username `admin`).

On first start the server:
- creates `data/runtime/decoture.db`;
- fills it from `data/stock.csv`;
- creates the admin account. Without `ADMIN_PASSWORD` it makes a random password and prints it once in the log.

Run the tests with `npm test`.

## What the admin panel does

| Section | What you can do |
|---|---|
| Overview | New orders to confirm, orders and sales this month, chairs with 10 or fewer left |
| Orders | Filter by status, open an order, call or WhatsApp the customer, change the status (New, Confirmed, Shipped, Delivered, Cancelled), leave a message the customer sees on their tracking page, keep an internal note, download all orders as CSV |
| Products & stock | Edit price, sale price and stock for each colourway, hide a chair from the store, replace its photo, add a new model or colour |
| Office quotes | Requests from the "For offices" page and the home page, with a status for each |
| Settings | Change the admin password (this logs out other devices) |

How stock works:
- Placing an order takes the chairs out of stock straight away, so two customers can't buy the last chair.
- Cancelling an order puts the chairs back.
- The store always uses the database's price and sale price, never a price sent by the browser.

## How customers order

1. They add chairs to the cart and check out with **cash on delivery**.
2. The order is saved on the server and they get an order number like `DC-261027-AB12`.
3. They can follow it on `/track.html` with that number and their mobile number.
4. The team sees the order in the admin panel, calls the customer and moves it through the statuses.

Email is optional. When SMTP is set up:
- the shop gets an email for each new order and quote request;
- customers who gave an email get a confirmation and status updates.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `DATA_DIR` | `data/runtime` | Where the database and uploaded photos live. On a host, point this at a persistent disk |
| `ADMIN_USER` | `admin` | First admin username (used on first start only) |
| `ADMIN_PASSWORD` | random, printed once | First admin password (first start only; change it later in Settings) |
| `SITE_URL` | | Public address, for example `https://decoture.com`, used for tracking links in emails |
| `TRUST_PROXY` | off | Set to `1` behind Render, Railway, Nginx or Cloudflare so HTTPS and visitor IPs are detected |
| `SMTP_HOST`, `SMTP_PORT` | port `465` | Mail server for notifications (SMTP over TLS) |
| `SMTP_USER`, `SMTP_PASS` | | Mail login. For Gmail, use an app password |
| `MAIL_FROM` | `SMTP_USER` | Sender address |
| `MAIL_TO` | `MAIL_FROM` | Where new orders and quote requests are sent |

## Putting it online

Any host that runs Node 22 and keeps files on a disk will work.

**Render** (about $7 a month plus $0.25 for a 1 GB disk):
1. Create a new **Web Service** from this GitHub repo.
2. Set the build command to `true` and the start command to `npm start`.
3. Add a **Disk** mounted at `/var/data`.
4. Set `DATA_DIR=/var/data`, `TRUST_PROXY=1`, `ADMIN_PASSWORD`, `SITE_URL` and the mail settings.
5. Point your domain at the service from Render's Custom Domains page.

**Railway** works the same way: add a volume, then set `DATA_DIR` to its mount path.

**A VPS or Docker host:**

```sh
docker build -t decoture .
docker run -d -p 8080:8080 -v decoture-data:/data -e ADMIN_PASSWORD=... -e TRUST_PROXY=1 decoture
```

Put Nginx or Caddy in front for HTTPS.

**Backups:** copy `decoture.db` and the `uploads/` folder from `DATA_DIR`. One file holds all orders, products and quotes.

**Static hosting** (GitHub Pages, Netlify) still works for a demo. Without the server:
- the catalog comes from `assets/js/catalog.js`;
- checkout falls back to sending the order on WhatsApp or by email;
- there is no admin panel or order tracking.

## Product data

On a fresh database, products come from `data/stock.csv`, one row per colourway:

| Column | Meaning |
|---|---|
| `model`, `colour` | Rows with the same model become one product with colour options |
| `collection` | `executive`, `ergonomic`, `task` or `training` |
| `stock` | Units in the warehouse. 10 or fewer shows "Only N left"; 0 shows "Out of stock" |
| `warranty_years` | 2 for most chairs, 1 for CDS conference chairs |
| `image` | File name in `assets/img/products/` |
| `price_bdt`, `sale_price_bdt` | Price in taka. A sale price shows the regular price struck through |

After the first start, make changes in the admin panel instead: the database is the source of truth. `npm run build:catalog` rebuilds the static `catalog.js` from the CSV for static hosting.

Every chair is currently priced at ৳8,900 as a placeholder.

## Code map

| Path | What it is |
|---|---|
| `index.html`, `shop.html`, `product.html`, `cart.html`, `checkout.html`, `order.html`, `track.html`, `offices.html`, `about.html`, `contact.html` | Storefront pages |
| `assets/js/` | Storefront scripts: `app.js` (shared), `motion.js` (animation), `chair3d.js` (3D chair), one script per page |
| `admin/` | Admin panel |
| `server/` | `server.mjs` starts the server; `app.mjs` handles routes and security; `db.mjs` is the database; `auth.mjs` handles passwords and sessions; `mail.mjs` sends email |
| `lib/catalog.mjs` | Builds the catalog shape, used by both the server and the static build |
| `test/` | Server tests (`npm test`) |

## Security notes

- Admin passwords are hashed with scrypt.
- Sessions use an HttpOnly, SameSite=Strict cookie, and only a hash of each token is stored.
- Login, orders, quotes and tracking are rate limited.
- Write requests must be JSON from the store's own pages.
- A Content Security Policy only allows the site's own scripts.
- The database, server code and data files are never served.
- Uploaded photos are checked to be real JPEG, PNG or WebP files.
- Order tracking needs both the order number and the phone it was placed with.

## Brand

Colours and type come from the Decoture brand guidelines: Signature Gold `#D4AF37`, Warm Bronze `#C5A059`, Deep Charcoal `#1C2321`, and DM Sans.

## Next

- Online payment through SSLCommerz (bKash, Nagad, cards).
- Delivery zones and charges, SEO and analytics.
- Customer accounts, and furniture beyond chairs.
