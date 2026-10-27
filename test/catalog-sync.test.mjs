// The price list in data/stock.csv is loaded into the database again whenever it changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.mjs';

const HEAD = 'sl,code,model,colour,collection,stock,warranty_years,features,image,gallery,price_bdt,sale_price_bdt';

test('a new price list updates, adds and hides chairs, and leaves admin edits alone until then', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decoture-sync-'));
  const csv = join(dir, 'stock.csv');
  const file = join(dir, 'test.db');
  try {
    writeFileSync(csv, `${HEAD}\n1,X-1,A1,Black,ergonomic,10,2,,a1-black.webp,a1-black-2.webp|a1-black-3.webp,9000,\n2,X-2,B2,Grey,task,5,2,,,,7000,\n`);
    let db = openDb(file, { seedCsv: csv });
    const a1 = db.catalog().products.find((p) => p.slug === 'a1').variants[0];
    assert.equal(a1.code, 'X-1');
    assert.deepEqual(a1.gallery, ['assets/img/products/a1-black.webp', 'assets/img/products/a1-black-2.webp', 'assets/img/products/a1-black-3.webp']);

    db.updateVariant('a1-black', { stock: 3 });
    db.close();
    db = openDb(file, { seedCsv: csv });
    assert.equal(db.variant('a1-black').stock, 3, 'same list: the admin edit stays');
    db.close();

    writeFileSync(csv, `${HEAD}\n1,X-1,A1,Black,ergonomic,40,2,,a1-black.webp,,9500,\n3,X-3,C3,Green,training,8,2,,,,4000,\n`);
    db = openDb(file, { seedCsv: csv });
    assert.equal(db.variant('a1-black').stock, 40, 'new list: its stock and price win');
    assert.equal(db.variant('a1-black').price, 9500);
    assert.equal(db.variant('b2-grey').active, false, 'a chair no longer listed is hidden, not deleted');
    assert.deepEqual(db.catalog().products.map((p) => p.slug).sort(), ['a1', 'c3']);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
