// Long-running worker for the server (replaces the hourly GitHub Action).
//
//   hourly  :05          snapshot  -> history.db + status/*.json
//   nightly 03:30 (NL)   generate  -> crop-outs, detail bundles, national files (fresh NDW + tariffs)
//                        analysis  -> data/derived/gemeente-metrics.geojson (if LPV_ANALYSIS_DIR is set)
//                        backup    -> history.db copy in STATE_DIR/backups (keeps BACKUP_KEEP)
//
// Jobs run one at a time from a single queue (they share the NDW download
// cache) and each runs as a child process so its memory is released after.
// Writes land directly on the data volume that nginx serves: no commit, no deploy.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKUP_DIR, MUNICIPALITIES_JSON, PIPELINE_ROOT } from './paths.js';
import { openHistory } from './history.js';

const SNAPSHOT_MINUTE = Number(process.env.LPV_SNAPSHOT_MINUTE ?? 5);
const NIGHTLY_AT = process.env.LPV_NIGHTLY_AT ?? '03:30'; // Europe/Amsterdam
const ANALYSIS_DIR = process.env.LPV_ANALYSIS_DIR; // unset -> skip analysis
const PYTHON = process.env.LPV_PYTHON ?? 'python3';
const BACKUP_KEEP = Number(process.env.LPV_BACKUP_KEEP ?? 14);
const TSX = join(PIPELINE_ROOT, 'node_modules', '.bin', 'tsx');

type Job = { name: string; run: () => Promise<void> };
const queue: Job[] = [];
let running = false;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function amsterdamClock(): { date: string; hhmm: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = String(Number(get('hour')) % 24).padStart(2, '0');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${hh}:${get('minute')}`, minute: Number(get('minute')) };
}

function exec(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

const jobs = {
  snapshot: (): Job => ({ name: 'snapshot', run: () => exec(TSX, ['src/snapshot.ts'], PIPELINE_ROOT) }),
  generate: (): Job => ({ name: 'generate', run: () => exec(TSX, ['src/index.ts', '--refresh'], PIPELINE_ROOT) }),
  analysis: (): Job => ({ name: 'analysis', run: () => exec(PYTHON, ['-m', 'src.main'], ANALYSIS_DIR!) }),
  backup: (): Job => ({
    name: 'backup',
    run: async () => {
      await mkdir(BACKUP_DIR, { recursive: true });
      const db = openHistory();
      try {
        await db.backup(join(BACKUP_DIR, `history-${amsterdamClock().date}.db`));
      } finally {
        db.close();
      }
      const old = (await readdir(BACKUP_DIR)).filter((f) => /^history-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) await rm(join(BACKUP_DIR, f));
    },
  }),
};

function enqueue(job: Job) {
  if (queue.some((j) => j.name === job.name)) return; // already pending
  queue.push(job);
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    const t0 = Date.now();
    log(`start ${job.name}`);
    try {
      await job.run();
      log(`done  ${job.name} (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (err) {
      log(`FAIL  ${job.name}: ${(err as Error).message}`);
    }
  }
  running = false;
}

function nightly() {
  enqueue(jobs.generate());
  if (ANALYSIS_DIR) enqueue(jobs.analysis());
  enqueue(jobs.backup());
}

let lastTick = '';
function tick() {
  const { date, hhmm, minute } = amsterdamClock();
  const key = `${date} ${hhmm}`;
  if (key === lastTick) return;
  lastTick = key;
  if (minute === SNAPSHOT_MINUTE) enqueue(jobs.snapshot());
  if (hhmm === NIGHTLY_AT) nightly();
}

log(`worker up: snapshot hourly at :${String(SNAPSHOT_MINUTE).padStart(2, '0')}, nightly at ${NIGHTLY_AT} Europe/Amsterdam` +
  (ANALYSIS_DIR ? `, analysis in ${ANALYSIS_DIR}` : ', analysis disabled'));

// Empty data volume: build the static data set first so the site has something to serve.
if (!existsSync(MUNICIPALITIES_JSON)) {
  log('no municipalities.json yet -> running initial generate');
  nightly();
}
if (process.argv.includes('--now')) enqueue(jobs.snapshot());

setInterval(tick, 15_000);
tick();

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log(`${sig}: exiting${running ? ' (job in progress is interrupted; it reruns on the next schedule)' : ''}`);
    process.exit(0);
  });
}
