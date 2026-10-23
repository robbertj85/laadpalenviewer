// Centralized filesystem paths for the pipeline.
//
// Defaults write into the repo (webapp/public + data-pipeline/.data) for local
// dev. On the server the worker container points them at the data volume:
//   LPV_PUBLIC_DIR  -> web-served files (municipalities.json + data/)
//   LPV_STATE_DIR   -> non-public state (history.db, backups)
//   LPV_CACHE_DIR   -> download cache
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// data-pipeline/
export const PIPELINE_ROOT = resolve(__dirname, '..');
// laadpalenviewer/
export const PROJECT_ROOT = resolve(PIPELINE_ROOT, '..');

export const CACHE_DIR = process.env.LPV_CACHE_DIR ?? join(PIPELINE_ROOT, '.cache');
export const PIPELINE_DATA_DIR = join(PIPELINE_ROOT, 'data');

// webapp output targets
export const WEBAPP_PUBLIC = process.env.LPV_PUBLIC_DIR ?? join(PROJECT_ROOT, 'webapp', 'public');
export const DATA_DIR = join(WEBAPP_PUBLIC, 'data');
export const GEMEENTEN_DIR = join(DATA_DIR, 'gemeenten');
export const SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots'); // legacy per-day JSON (read by importHistory only)
export const STATUS_DIR = join(DATA_DIR, 'status');
export const MUNICIPALITIES_JSON = join(WEBAPP_PUBLIC, 'municipalities.json');

// Non-public state: the usage history database and its backups.
export const STATE_DIR = process.env.LPV_STATE_DIR ?? join(PIPELINE_ROOT, '.data');
export const HISTORY_DB = process.env.LPV_HISTORY_DB ?? join(STATE_DIR, 'history.db');
export const BACKUP_DIR = join(STATE_DIR, 'backups');
