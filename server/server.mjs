#!/usr/bin/env node
// Starts the Decoture store. Configuration comes from environment variables (see README).
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { createApp } from './app.mjs';
import { createMailer } from './mail.mjs';
import { createGateway } from './sslcommerz.mjs';
import { hashPassword } from './auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const dataDir = resolve(env.DATA_DIR || join(root, 'data', 'runtime'));
mkdirSync(dataDir, { recursive: true });

const db = openDb(join(dataDir, 'decoture.db'), { seedCsv: join(root, 'data', 'stock.csv') });

// The first admin account is created from ADMIN_USER / ADMIN_PASSWORD, or with a random
// password printed once to the log.
if (db.adminCount() === 0) {
  const username = (env.ADMIN_USER || 'admin').toLowerCase();
  const password = env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.addAdmin(username, hashPassword(password));
  console.log(`[setup] Admin account "${username}" created.${env.ADMIN_PASSWORD ? '' : ` Password: ${password}  (change it in Admin > Settings)`}`);
}

const mailer = createMailer({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 465),
  secure: env.SMTP_SECURE !== 'false',
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
  from: env.MAIL_FROM || env.SMTP_USER,
  fromName: 'Decoture',
});

// Online payment is offered only when SSLCommerz store details are set. Without
// SSLCOMMERZ_LIVE=1 payments go to the SSLCommerz sandbox, where no real money moves.
const gateway = createGateway({
  storeId: env.SSLCOMMERZ_STORE_ID,
  storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
  live: env.SSLCOMMERZ_LIVE === '1' || env.SSLCOMMERZ_LIVE === 'true',
});

const app = createApp({
  db,
  root,
  uploadsDir: join(dataDir, 'uploads'),
  mailer,
  gateway,
  config: {
    mailTo: env.MAIL_TO || env.MAIL_FROM || env.SMTP_USER,
    siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  },
});

const port = Number(env.PORT || 8080);
const server = http.createServer(app);
server.listen(port, env.HOST || '0.0.0.0', () => {
  console.log(`Decoture store on http://localhost:${port}  (data in ${dataDir}, email ${mailer.enabled ? 'on' : 'off'}, online payment ${gateway.enabled ? gateway.mode : 'off'})`);
});

// Every 15 minutes, cancel online orders left unpaid for a day so their chairs go back on sale.
const sweep = () => {
  const ids = db.expireUnpaid(24);
  if (ids.length) console.log(`[orders] Cancelled unpaid online orders: ${ids.join(', ')}`);
};
setInterval(sweep, 15 * 60 * 1000).unref();
sweep();
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
