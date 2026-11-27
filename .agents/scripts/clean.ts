/**
 * Safe build cleanup script modeled after Google TypeScript Style (gts clean).
 * Reads outDir from tsconfig.json and removes build and cache directories safely.
 */

import {rm} from 'node:fs/promises';
import {join} from 'node:path';

async function safeClean(): Promise<void> {
  const cwd = process.cwd();
  let outDir = 'build';

  try {
    const tsconfigContent = await Bun.file(join(cwd, 'tsconfig.json')).text();
    const parsed = JSON.parse(tsconfigContent);
    if (parsed.compilerOptions?.outDir) {
      outDir = parsed.compilerOptions.outDir;
    }
  } catch {
    // Default to 'build'
  }

  if (outDir === '.' || outDir === '/' || outDir === './') {
    console.error('ERROR: outDir cannot be root directory. Refusing to delete.');
    process.exit(1);
  }

  const targets = [join(cwd, outDir), join(cwd, '.agents', 'logs'), join(cwd, '.agents', '.cache')];

  for (const target of targets) {
    try {
      await rm(target, {recursive: true, force: true});
      console.log(`Cleaned: ${target}`);
    } catch (err) {
      console.warn(`Could not remove ${target}:`, err);
    }
  }

  console.log('Safe clean complete.');
}

void safeClean();
