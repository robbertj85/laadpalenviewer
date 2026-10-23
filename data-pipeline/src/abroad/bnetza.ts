// Germany: the Bundesnetzagentur Ladesäulenregister (CC BY 4.0), a monthly CSV
// of every reported public charging device (~116k) with operator, plug types
// and per-plug power. No live status, no tariffs. Devices are grouped into sites
// (operator + ~11 m coordinate cell); a site is kept when it is a truck site
// (truck operator, "Lkw"/"Truck" in the name, an MCS plug) or has a DC plug of
// >= 350 kW.
import { cachedText } from './cache.js';
import { THRESHOLDS, truckSignal } from '../classifyFreight.js';
import type { NormalizedFreightLocation } from '../types.js';

const PAGE_URL =
  'https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html';
const FILE_BASE =
  'https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/';
const HPC_KW = THRESHOLDS.FREIGHT_DC_WATTS / 1000;

// The CSV is published under a dated name; take the newest one linked from the page.
async function latestCsvUrl(): Promise<string> {
  const page = await (await fetch(PAGE_URL)).text();
  const names = [...page.matchAll(/Ladesaeulenregister_BNetzA_[\d-]+\.csv/g)].map((m) => m[0]).sort();
  if (!names.length) throw new Error('no Ladesäulenregister CSV link on the BNetzA page');
  return FILE_BASE + names[names.length - 1];
}

// ';'-separated, '"'-quoted (quoted fields contain ';'), CRLF or LF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const num = (s: string | undefined) => Number((s ?? '').trim().replace(/\./g, '').replace(',', '.'));
const coord = (s: string | undefined) => Number((s ?? '').trim().replace(',', '.'));

interface Site {
  deviceId: string; // first Ladeeinrichtungs-ID seen: stable across runs
  operator: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  maxDcKw: number;
  maxKw: number;
  hasMcs: boolean;
  points: number;
}

export async function fetchBnetza(refresh: boolean): Promise<NormalizedFreightLocation[]> {
  // Published monthly: a week-old copy is fresh enough.
  const text = await cachedText('bnetza-ladesaeulenregister.csv', latestCsvUrl, { refresh, maxAgeDays: 7 });
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const headerAt = rows.findIndex((r) => r[0] === 'Ladeeinrichtungs-ID');
  if (headerAt < 0) throw new Error('CSV header row not found');
  const header = rows[headerAt];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV column missing: ${name}`);
    return i;
  };
  const C = {
    operator: col('Betreiber'),
    display: col('Anzeigename (Karte)'),
    status: col('Status'),
    points: col('Anzahl Ladepunkte'),
    street: col('Straße'),
    number: col('Hausnummer'),
    city: col('Ort'),
    lat: col('Breitengrad'),
    lng: col('Längengrad'),
    place: col('Standortbezeichnung'),
    plugs: [1, 2, 3, 4, 5, 6].map((n) => [col(`Steckertypen${n}`), col(`Nennleistung Stecker${n}`)] as const),
  };

  const sites = new Map<string, Site>();
  for (const r of rows.slice(headerAt + 1)) {
    if (r.length < header.length - 5 || r[C.status] !== 'In Betrieb') continue;
    const lat = coord(r[C.lat]);
    const lng = coord(r[C.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const operator = r[C.operator].trim();
    const key = `${operator}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    let site = sites.get(key);
    if (!site) {
      site = {
        deviceId: r[0].trim(),
        operator,
        name: r[C.place].trim() || r[C.display].trim() || operator,
        address: [r[C.street], r[C.number]].map((s) => s.trim()).filter(Boolean).join(' '),
        city: r[C.city].trim(),
        lat,
        lng,
        maxDcKw: 0,
        maxKw: 0,
        hasMcs: false,
        points: 0,
      };
      sites.set(key, site);
    }
    site.points += num(r[C.points]) || 0;
    for (const [typeCol, powerCol] of C.plugs) {
      const type = r[typeCol] ?? '';
      if (!type) continue;
      const kw = num(r[powerCol]) || 0;
      site.maxKw = Math.max(site.maxKw, kw);
      if (/\bDC\b|CCS|CHAdeMO|Megawatt|MCS/i.test(type)) site.maxDcKw = Math.max(site.maxDcKw, kw);
      if (/Megawatt|MCS/i.test(type)) site.hasMcs = true;
    }
  }

  const out: NormalizedFreightLocation[] = [];
  for (const s of sites.values()) {
    const signal = truckSignal(s.operator, `${s.name} ${s.operator}`);
    const reason = signal ?? (s.hasMcs ? 'mcs' : undefined);
    if (!reason && s.maxDcKw < HPC_KW) continue;
    out.push({
      id: `bnetza:${s.deviceId}`,
      source: 'bnetza',
      country: 'DE',
      name: s.name,
      address: s.address || undefined,
      city: s.city || undefined,
      lat: s.lat,
      lng: s.lng,
      operatorName: s.operator,
      maxPowerKw: Math.round(s.maxKw),
      isMegawatt: s.hasMcs || s.maxKw >= THRESHOLDS.MEGAWATT_WATTS / 1000,
      freightKind: reason ? 'dedicated' : 'hpc',
      freightReason: reason ?? 'power',
    });
  }
  return out;
}
