// Usage history store (SQLite). Replaces the per-gemeente per-day JSON files
// that used to be committed to git every hour.
//
// One row per (location, Amsterdam-local day) holding 24 hourly occupancy
// bytes: 0-100 = % of connectors charging, 255 = no sample for that hour.
// ~43k locations x 365 days ≈ 16M compact rows ≈ 0.7 GB/year, no rollup needed.
//
// The webapp reads this file (read-only) for /api/usage, the analysis layer
// reads it with Python's sqlite3. Keep the schema in sync with
// webapp/lib/history.ts and analysis/src/ingest/chargers.py.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HISTORY_DB } from './paths.js';

export const NO_SAMPLE = 255;

export type HistoryDb = Database.Database;

export function openHistory(path = HISTORY_DB): HistoryDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // readers (webapp) never block the hourly writer
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 120000'); // a merge and the hourly snapshot may overlap
  db.exec(`
    CREATE TABLE IF NOT EXISTS location (
      id      INTEGER PRIMARY KEY,
      ocpi_id TEXT NOT NULL UNIQUE,  -- sanitized OCPI location id (= locationId in the GeoJSON)
      slug    TEXT NOT NULL          -- gemeente slug, last seen
    );
    CREATE INDEX IF NOT EXISTS location_slug ON location(slug);
    CREATE TABLE IF NOT EXISTS occ_day (
      loc INTEGER NOT NULL REFERENCES location(id),
      day INTEGER NOT NULL,          -- days since 1970-01-01 (Amsterdam-local date)
      n   INTEGER NOT NULL,          -- EVSE count at last sample
      occ BLOB    NOT NULL,          -- 24 bytes, see NO_SAMPLE
      PRIMARY KEY (loc, day)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS occ_day_day ON occ_day(day);
  `);
  return db;
}

export function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function dayString(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function emptyOcc(): Buffer {
  return Buffer.alloc(24, NO_SAMPLE);
}

// Returns a function that records hourly samples; call inside a transaction.
// `occ` holds per-hour values (null = no sample). Existing samples are kept
// where the new row has none, so imports and live snapshots merge safely.
export function makeRecorder(db: HistoryDb) {
  const upsertLoc = db.prepare(
    `INSERT INTO location (ocpi_id, slug) VALUES (?, ?)
     ON CONFLICT(ocpi_id) DO UPDATE SET slug = excluded.slug
     RETURNING id`,
  );
  const getDay = db.prepare<[number, number], { n: number; occ: Buffer }>(
    'SELECT n, occ FROM occ_day WHERE loc = ? AND day = ?',
  );
  const putDay = db.prepare('INSERT OR REPLACE INTO occ_day (loc, day, n, occ) VALUES (?, ?, ?, ?)');
  const ids = new Map<string, number>();

  return (ocpiId: string, slug: string, day: number, n: number, occ: (number | null)[]) => {
    const key = `${ocpiId}\0${slug}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = (upsertLoc.get(ocpiId, slug) as { id: number }).id;
      ids.set(key, id);
    }
    const prev = getDay.get(id, day);
    const buf = prev ? Buffer.from(prev.occ) : emptyOcc();
    let any = false;
    for (let h = 0; h < 24; h++) {
      const v = occ[h];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      buf[h] = Math.max(0, Math.min(100, Math.round(v)));
      any = true;
    }
    if (!any && prev) return;
    putDay.run(id, day, n, buf);
  };
}
