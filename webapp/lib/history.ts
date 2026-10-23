// Server-only reader for the usage history DB written by the data pipeline
// (data-pipeline/src/history.ts — keep the schema in sync).
//
// occ_day: one row per (location, Amsterdam-local day), 24 hourly bytes:
// 0-100 = % of connectors charging, 255 = no sample.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const NO_SAMPLE = 255;
// Set by the Docker image; for local dev in .env.development. Env-only on
// purpose: a computed fallback path makes Next trace the whole project.
const DB_PATH = process.env.LPV_HISTORY_DB;

let db: Database.Database | null = null;

function open(): Database.Database | null {
  if (db) return db;
  if (!DB_PATH || !existsSync(DB_PATH)) return null;
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

export interface HourlyDay {
  date: string;
  occ: (number | null)[]; // 24 values
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const dayString = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

function rows(locationId: string, fromDay: number, toDay: number) {
  const conn = open();
  if (!conn) return [];
  return conn
    .prepare(
      `SELECT d.day AS day, d.occ AS occ
         FROM occ_day d JOIN location l ON l.id = d.loc
        WHERE l.ocpi_id = ? AND d.day BETWEEN ? AND ?
        ORDER BY d.day`,
    )
    .all(locationId, fromDay, toDay) as { day: number; occ: Buffer }[];
}

const decode = (occ: Buffer) => Array.from(occ, (b) => (b === NO_SAMPLE ? null : b));

// Hourly series for the `days` Amsterdam-local days ending at `today` (inclusive);
// days without any sample come back as all-null so the x-axis stays continuous.
export function hourly(locationId: string, today: string, days: number): HourlyDay[] {
  const to = dayNumber(today);
  const from = to - days + 1;
  const byDay = new Map(rows(locationId, from, to).map((r) => [r.day, decode(r.occ)]));
  const out: HourlyDay[] = [];
  for (let d = from; d <= to; d++) out.push({ date: dayString(d), occ: byDay.get(d) ?? Array(24).fill(null) });
  return out;
}

// Daily average occupancy (over sampled hours) for the last `days` days.
export function dailyAverages(locationId: string, today: string, days: number): Record<string, number> {
  const to = dayNumber(today);
  const out: Record<string, number> = {};
  for (const r of rows(locationId, to - days + 1, to)) {
    const vals = decode(r.occ).filter((v): v is number => v !== null);
    if (vals.length) out[dayString(r.day)] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return out;
}
