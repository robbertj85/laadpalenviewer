// Download-with-cache for the neighbouring-country sources: reuse a fresh copy,
// refetch when stale, and fall back to a stale copy when the download fails.
import { join } from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { CACHE_DIR } from '../paths.js';
import { writeFileAtomic } from '../fsAtomic.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function cachedText(
  name: string,
  url: string | (() => Promise<string>),
  { refresh = false, maxAgeDays = 1 }: { refresh?: boolean; maxAgeDays?: number } = {},
): Promise<string> {
  const path = join(CACHE_DIR, 'abroad', name);
  let cached: string | null = null;
  try {
    const s = await stat(path);
    cached = await readFile(path, 'utf-8');
    if (!refresh && Date.now() - s.mtimeMs < maxAgeDays * DAY_MS) return cached;
  } catch {
    // no cache yet
  }
  try {
    const target = typeof url === 'string' ? url : await url();
    const res = await fetch(target, { headers: { 'User-Agent': 'laadpalenviewer (prototype.transportlab.app)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${target}`);
    const text = await res.text();
    await mkdir(join(CACHE_DIR, 'abroad'), { recursive: true });
    await writeFileAtomic(path, text);
    return text;
  } catch (err) {
    if (cached !== null) {
      console.warn(`  [abroad] ${name}: download failed (${(err as Error).message}); using cached copy`);
      return cached;
    }
    throw err;
  }
}
