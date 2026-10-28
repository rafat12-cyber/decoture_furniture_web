# Decoture store

The online shop for **DECOTURE, a brand of Sigma Synchrony**, a contemporary furniture and lifestyle brand in Dhaka. It sells the imported chair range from the corporate price list of 27 October 2026: 52 models in 82 colourways, in five categories (Executive, Ergonomic, Task & office, Conference & visitor, Training).

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
| Products | A list of every chair, and an edit page for each one: its name (shown with the model number), category, warranty, features and description; each colour's price, sale price, stock, swatch and on-sale switch; and its photos (add several angles at once, choose the main one, reorder, remove). "Quick stock edit" changes many prices and stock counts in one table. Edits to names, details and photos survive a new price list; uploads are kept in `DATA_DIR/uploads` |
| Office quotes | Requests from the "For offices" page and the home page, with a status for each |
| Settings | Delivery charges by zone, whether online payment is on, change the admin password (this logs out other devices) |

How stock works:
- Placing an order takes the chairs out of stock straight away, so two customers can't buy the last chair.
- Cancelling an order puts the chairs back.
- The store always uses the database's price and sale price, never a price sent by the browser.

## How customers order

1. They add chairs to the cart and choose their district at checkout, which shows the delivery charge and the total.
2. They pay with **cash on delivery**, or **online** with bKash, Nagad, Rocket or a card through SSLCommerz (when it is set up).
3. The order is saved on the server and they get an order number like `DC-261027-AB12`.
4. They can follow it on `/track.html` with that number and their mobile number.
5. The team sees the order in the admin panel, calls the customer and moves it through the statuses.

### Delivery charges

There are three zones: Inside Dhaka, Near Dhaka (Gazipur, Narayanganj, Narsingdi, Manikganj, Munshiganj), and Outside Dhaka for every other district.

- Each zone has a charge for the first chair and a charge for each extra chair.
- You can also set an order amount above which delivery is free.
- Change them in **Admin > Settings**.

The starting values are placeholders: ৳300 / ৳500 / ৳800 for the first chair, and ৳100 / ৳150 / ৳200 for each extra chair.

### Online payment (SSLCommerz)

1. Get a merchant account at [sslcommerz.com](https://sslcommerz.com). For testing, a free sandbox account at [developer.sslcommerz.com](https://developer.sslcommerz.com/registration/) works.
2. Set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` and `SITE_URL` on the server. Without `SSLCOMMERZ_LIVE=1`, payments go to the sandbox and no real money moves.
3. Checkout then offers "bKash, Nagad, Rocket or card".

How a payment works:

- The customer pays on the SSLCommerz page and comes back to their order page.
- The server checks every payment with SSLCommerz's validation API, including the transaction ID, the amount and the currency, before it marks an order paid. The browser's word is never enough.
- SSLCommerz also calls `/api/pay/sslcommerz/ipn`. You can set that address as the IPN URL in the merchant panel.
- If a payment fails or the customer leaves, the chairs stay held. From the order or tracking page, the customer can pay again or switch to cash on delivery.
- Unpaid online orders are cancelled after 24 hours, and their chairs go back on sale.
- Refunds are made in the SSLCommerz merchant panel.
- Orders with a chair priced on request can only be paid on delivery.

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
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | | Turns on online payment |
| `SSLCOMMERZ_LIVE` | off (sandbox) | Set to `1` to take real payments |

## Putting it online

Any host that runs Node 22 and keeps files on a disk will work.

**Render** (about $7 a month plus $0.25 for a 1 GB disk):
1. Create a new **Web Service** from this GitHub repo.
2. Set the build command to `true` and the start command to `npm start`.
3. Add a **Disk** mounted at `/var/data`.
4. Set `DATA_DIR=/var/data`, `TRUST_PROXY=1`, `ADMIN_PASSWORD`, `SITE_URL`, the mail settings and, for online payment, the SSLCommerz settings.
5. Point your domain at the service from Render's Custom Domains page.

**Railway** works the same way: add a volume, then set `DATA_DIR` to its mount path.

**A VPS or Docker host:**

```sh
docker build -t decoture .
docker run -d -p 8080:8080 -v decoture-data:/data -e ADMIN_PASSWORD=... -e TRUST_PROXY=1 decoture
```

Put Nginx or Caddy in front for HTTPS.

**Updating a live store (cPanel, e.g. HostNin):**
1. Merge the pull request on GitHub, then download the ZIP of `main`.
2. In cPanel File Manager, upload the ZIP to the app folder (`~/decoture`) and extract it over the old files.
3. In **Setup Node.js App**, press **Restart**.

Orders, quotes, admin accounts and uploaded photos live in `DATA_DIR`, outside the app folder, so they are not touched. If `data/stock.csv` changed, the new price list is loaded on restart (see Product data).

**Backups:** copy `decoture.db` and the `uploads/` folder from `DATA_DIR`. One file holds all orders, products and quotes.

**Static hosting** (GitHub Pages, Netlify) still works for a demo. Without the server:
- the catalog comes from `assets/js/catalog.js`;
- checkout falls back to sending the order on WhatsApp or by email;
- there is no admin panel or order tracking.

## Search engines and sharing

- Every page the server sends has a canonical address and Open Graph tags, so links shared on Facebook and WhatsApp show a title, a description and a picture. Set `SITE_URL` so these use your domain.
- Product pages get their real title, description and schema.org `Product` data (price in BDT, stock) written in by the server.
- The home page carries the shop's `FurnitureStore` details (address, phone).
- `/sitemap.xml` lists every page, collection and chair, and `/robots.txt` points to it.
- The cart, checkout, order and tracking pages, and the admin panel, are kept out of search results.
- After going live, add the site to [Google Search Console](https://search.google.com/search-console) and submit `https://your-domain/sitemap.xml`.

## Product data

Products come from `data/stock.csv`, one row per colourway:

| Column | Meaning |
|---|---|
| `sl`, `code` | Row number and Decoture product code from the price list |
| `model`, `colour` | Rows with the same model become one product with colour options. The site shows the model with its name from `NAMES` in `lib/catalog.mjs`, e.g. "Monarch 6801A"; a new model without a name shows its number alone |
| `collection` | `executive`, `ergonomic`, `task`, `conference` or `training`; each is a category in the Shop menu |
| `stock` | Units in the warehouse. 10 or fewer shows "Only N left"; 0 shows "Out of stock" |
| `warranty_years` | 2 for most chairs, 1 for CDS conference chairs |
| `image` | Main photo, a file name in `assets/img/products/` |
| `gallery` | More angles of the same colourway, separated by `|`; shown as thumbnails on the product page |
| `price_bdt`, `sale_price_bdt` | Price in taka. A sale price shows the regular price struck through |

The server loads the CSV into the database on first start, and again on any start where the file has changed (a new price list). Then every row in the file is added or overwritten, including stock and price, and colourways no longer in the file are hidden from the shop (never deleted, so old orders keep their details). Between price lists the database is the source of truth: edit stock and prices in the admin panel, and those edits stay until the next price list is uploaded. `npm run build:catalog` rebuilds the static `catalog.js` from the CSV for static hosting.

Prices are the website rate from the price list, or the corporate price where there is no website rate. Rows with neither show "Price on request". The Dealer price is never shown.

## Code map

| Path | What it is |
|---|---|
| `index.html`, `shop.html`, `product.html`, `cart.html`, `checkout.html`, `order.html`, `track.html`, `offices.html`, `about.html`, `contact.html` | Storefront pages |
| `assets/js/` | Storefront scripts: `app.js` (shared), `motion.js` (animation), `chair-scene.js` (home page chair turntable, from photos in `assets/img/hero/`), one script per page |
| `admin/` | Admin panel |
| `server/` | `server.mjs` starts the server; `app.mjs` handles routes and security; `db.mjs` is the database; `auth.mjs` handles passwords and sessions; `mail.mjs` sends email; `sslcommerz.mjs` takes online payments; `seo.mjs` writes search and sharing tags, the sitemap and robots.txt |
| `lib/catalog.mjs`, `lib/delivery.mjs` | The catalog shape and the delivery zones, used by both the server and the static build |
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

- Analytics (for example Plausible or Google Analytics), once the domain is set.
- Customer accounts, and furniture beyond chairs.
