// Atomic file writes: nginx serves the data directory live, so a reader must
// never see a half-written file. Write to a temp sibling, then rename.
import { rename, writeFile } from 'node:fs/promises';

export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}
