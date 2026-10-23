// Merge another history DB (e.g. one built locally by import-history) into the
// live one, hour by hour: samples already present are kept where the incoming
// row has none. Safe to run while the worker is up, and safe to repeat.
//
//   npm run merge-history -- /srv/lpv/state/import.db
import Database from 'better-sqlite3';
import { openHistory, makeRecorder, NO_SAMPLE } from './history.js';

const src = process.argv[2];
if (!src) {
  console.error('usage: merge-history <other.db>');
  process.exit(2);
}

const other = new Database(src, { readonly: true, fileMustExist: true });
const db = openHistory();
const record = makeRecorder(db);

const rows = other
  .prepare('SELECT l.ocpi_id AS id, l.slug AS slug, d.day AS day, d.n AS n, d.occ AS occ FROM occ_day d JOIN location l ON l.id = d.loc')
  .iterate() as IterableIterator<{ id: string; slug: string; day: number; n: number; occ: Buffer }>;

// Commit in batches so the hourly snapshot never waits long for the write lock.
const BATCH = 20_000;
let batch: { id: string; slug: string; day: number; n: number; occ: Buffer }[] = [];
let total = 0;
const flush = db.transaction((items: typeof batch) => {
  for (const r of items) {
    record(r.id, r.slug, r.day, r.n, Array.from(r.occ, (b) => (b === NO_SAMPLE ? null : b)));
  }
});
for (const r of rows) {
  batch.push({ ...r, occ: Buffer.from(r.occ) });
  if (batch.length >= BATCH) {
    flush(batch);
    total += batch.length;
    batch = [];
    console.log(`  merged ${total} location-days`);
  }
}
flush(batch);
total += batch.length;

const stats = db.prepare('SELECT COUNT(*) AS rows, MIN(day) AS first, MAX(day) AS last FROM occ_day').get() as {
  rows: number;
  first: number;
  last: number;
};
const day = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
console.log(`Merged ${total} location-days from ${src}. history.db: ${stats.rows} rows, ${day(stats.first)} .. ${day(stats.last)}`);
other.close();
db.close();
