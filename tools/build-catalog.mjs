#!/usr/bin/env node
// Builds assets/js/catalog.js from data/stock.csv for static hosting.
// Edit the CSV (stock counts, prices, new rows), then run: node tools/build-catalog.mjs
// When the site runs on the server (server/server.mjs), the catalog comes from the database instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, catalogScript, parseCsv } from '../lib/catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = parseCsv(readFileSync(join(root, 'data/stock.csv'), 'utf8'));
const catalog = buildCatalog(rows);
writeFileSync(join(root, 'assets/js/catalog.js'), catalogScript(catalog));
console.log(`catalog.js: ${catalog.products.length} products, ${rows.length} variants`);
