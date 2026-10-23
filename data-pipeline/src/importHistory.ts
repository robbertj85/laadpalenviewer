// One-off / catch-up import of the legacy JSON snapshot history into history.db.
//
//   npm run import-history -- --git <repo> [--rev origin/main]   # every day-file ever committed
//   npm run import-history -- --dir <path/to/data/snapshots>      # a plain directory of day-files
//
// The hourly GitHub Action committed snapshots/<slug>/<YYYY-MM-DD>.json and,
// after 30 days, rolled them up into daily.json and deleted them. Git still
// holds every deleted file, so --git recovers full hourly resolution: for each
// deleted path we read its last version (the deleting commit's parent), for
// live paths the version at --rev. Imports merge per hour (existing samples
// are kept where the incoming file has none), so re-running is safe.
//
// daily.json is not imported: it is derived from the same day-files. Instead
// the importer reports any (gemeente, date) present in daily.json but missing
// from the recovered hourly data, so gaps are visible rather than papered over.
import { spawn, execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openHistory, makeRecorder, dayNumber } from './history.js';

interface DayFile {
  date: string;
  locations: Record<string, { n: number; occ: (number | null)[] }>;
}

const SNAP_PREFIX = 'webapp/public/data/snapshots/';
const DAY_RE = /^([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Stream `git cat-file --batch` for a list of "<rev>:<path>" specs.
async function* catFiles(repo: string, specs: string[]): AsyncGenerator<{ spec: string; body: Buffer | null }> {
  const proc = spawn('git', ['-C', repo, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const writer = (async () => {
    for (const s of specs) {
      if (!proc.stdin.write(`${s}\n`)) await new Promise((r) => proc.stdin.once('drain', r));
    }
    proc.stdin.end();
  })();

  let buf: Buffer = Buffer.alloc(0);
  let idx = 0;
  for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const nl = buf.indexOf(10);
      if (nl < 0) break;
      const header = buf.subarray(0, nl).toString();
      if (header.endsWith(' missing')) {
        yield { spec: specs[idx++], body: null };
        buf = buf.subarray(nl + 1);
        continue;
      }
      const size = Number(header.split(' ')[2]);
      if (buf.length < nl + 1 + size + 1) break; // wait for the full object
      yield { spec: specs[idx++], body: buf.subarray(nl + 1, nl + 1 + size) };
      buf = buf.subarray(nl + 1 + size + 1);
    }
  }
  await writer;
}

function gitSpecs(repo: string, rev: string): { spec: string; rel: string }[] {
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 30, encoding: 'utf-8' });
  const specs = new Map<string, string>(); // rel path -> spec (latest version wins)

  // Deleted day-files: last version is the parent of the deleting commit.
  // git log is newest-first, so the first deletion seen per path is the latest.
  let commit = '';
  for (const line of git('log', rev, '--diff-filter=D', '--name-only', '--format=C %H', '--', SNAP_PREFIX).split('\n')) {
    if (line.startsWith('C ')) commit = line.slice(2);
    else if (line.startsWith(SNAP_PREFIX)) {
      const rel = line.slice(SNAP_PREFIX.length);
      if (DAY_RE.test(rel) && !specs.has(rel)) specs.set(rel, `${commit}^:${line}`);
    }
  }
  // Day-files still present at rev.
  for (const line of git('ls-tree', '-r', '--name-only', rev, '--', SNAP_PREFIX).split('\n')) {
    const rel = line.slice(SNAP_PREFIX.length);
    if (DAY_RE.test(rel)) specs.set(rel, `${rev}:${line}`);
  }
  return [...specs].map(([rel, spec]) => ({ rel, spec }));
}

async function main() {
  const repo = arg('--git');
  const dir = arg('--dir');
  if (!repo && !dir) {
    console.error('usage: import-history --git <repo> [--rev origin/main] | --dir <snapshots dir>');
    process.exit(2);
  }

  const db = openHistory();
  const record = makeRecorder(db);
  const seen = new Set<string>(); // "slug/date" with hourly data
  const dailyDates = new Map<string, Set<string>>(); // slug -> dates in daily.json
  let files = 0;
  let rows = 0;

  const ingest = db.transaction((slug: string, day: DayFile) => {
    const dn = dayNumber(day.date);
    for (const [locId, { n, occ }] of Object.entries(day.locations ?? {})) {
      record(locId, slug, dn, n ?? 0, occ ?? []);
      rows++;
    }
  });

  const handle = (rel: string, body: Buffer) => {
    const m = rel.match(DAY_RE);
    if (!m) return;
    const day = JSON.parse(body.toString('utf-8')) as DayFile;
    day.date ??= m[2];
    ingest(m[1], day);
    seen.add(`${m[1]}/${day.date}`);
    if (++files % 2000 === 0) console.log(`  ${files} day-files, ${rows} location-days`);
  };

  if (repo) {
    const rev = arg('--rev') ?? 'HEAD';
    const list = gitSpecs(repo, rev);
    console.log(`Importing ${list.length} day-files from git (${repo} @ ${rev})`);
    const relBySpec = new Map(list.map((x) => [x.spec, x.rel]));
    for await (const { spec, body } of catFiles(repo, list.map((x) => x.spec))) {
      if (body) handle(relBySpec.get(spec)!, body);
      else console.warn(`  missing object: ${spec}`);
    }
    // daily.json at rev, for the coverage report only.
    for (const line of execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', rev, '--', SNAP_PREFIX], {
      maxBuffer: 1 << 30,
      encoding: 'utf-8',
    }).split('\n')) {
      if (!line.endsWith('/daily.json')) continue;
      const slug = line.slice(SNAP_PREFIX.length).split('/')[0];
      const daily = JSON.parse(execFileSync('git', ['-C', repo, 'show', `${rev}:${line}`], { maxBuffer: 1 << 28 }).toString()) as Record<string, Record<string, number>>;
      const dates = new Set<string>();
      for (const series of Object.values(daily)) for (const d of Object.keys(series)) dates.add(d);
      dailyDates.set(slug, dates);
    }
  }

  if (dir) {
    console.log(`Importing day-files from ${dir}`);
    for (const slug of await readdir(dir)) {
      let entries: string[];
      try {
        entries = await readdir(join(dir, slug));
      } catch {
        continue;
      }
      for (const f of entries) {
        if (DAY_RE.test(`${slug}/${f}`)) handle(`${slug}/${f}`, await readFile(join(dir, slug, f)));
      }
    }
  }

  const stats = db
    .prepare(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT loc) AS locs, MIN(day) AS first, MAX(day) AS last FROM occ_day`,
    )
    .get() as { rows: number; locs: number; first: number; last: number };
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  let gaps = 0;
  for (const [slug, dates] of dailyDates) {
    for (const d of dates) if (!seen.has(`${slug}/${d}`)) gaps++;
  }

  console.log(`\nImported ${files} day-files (${rows} location-days).`);
  console.log(
    `history.db now holds ${stats.rows} location-days for ${stats.locs} locations, ` +
      `${new Date(stats.first * 86_400_000).toISOString().slice(0, 10)} .. ${new Date(stats.last * 86_400_000).toISOString().slice(0, 10)}`,
  );
  if (dailyDates.size) {
    console.log(
      gaps === 0
        ? 'Coverage: every date in daily.json is backed by recovered hourly data.'
        : `Coverage: ${gaps} (gemeente, date) pairs exist only as daily averages (no hourly file found).`,
    );
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
