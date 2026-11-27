/**
 * Fast staged diff verification script for git pre-commit hooks.
 * Verifies only changed TypeScript files in sub-second time.
 */

import {spawnSync} from 'node:child_process';

if (process.env.SLEEK_SKIP_VERIFY === '1') {
  console.log('SLEEK_SKIP_VERIFY is active. Skipping pre-commit verification.');
  process.exit(0);
}

const diffOutput = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  encoding: 'utf-8',
});

if (diffOutput.status !== 0) {
  console.error('Failed to query git staged files.');
  process.exit(50);
}

const allStagedFiles = diffOutput.stdout
  .split(/\r?\n/)
  .map(f => f.trim())
  .filter(f => f.length > 0);

const stagedFiles = allStagedFiles.filter(
  f => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.d.ts'),
);
const hasStagedNative = allStagedFiles.some(f => f.startsWith('native/'));

if (stagedFiles.length === 0 && !hasStagedNative) {
  console.log('No staged TypeScript or native files to verify.');
  process.exit(0);
}

if (stagedFiles.length > 0) {
  console.log(`[Pre-commit] Verifying ${stagedFiles.length} staged TypeScript file(s)...`);

  // 1. Run Google TypeScript Style (GTS) check on staged files
  const gtsCheck = spawnSync('bun', ['run', '.agents/scripts/check-gts.ts', ...stagedFiles], {
    stdio: 'inherit',
  });

  if (gtsCheck.status !== 0) {
    console.error('\nPre-commit gate failed: GTS style violations detected in staged files.');
    console.error("Run 'bun run lint:style' for full diagnostic output.\n");
    process.exit(30);
  }

  // 2. Run ESLint on staged files
  const eslintCheck = spawnSync('bun', ['x', 'eslint', ...stagedFiles], {
    stdio: 'inherit',
  });

  if (eslintCheck.status !== 0) {
    console.error('\nPre-commit gate failed: ESLint errors detected in staged files.');
    console.error("Run 'bun run lint:fix' or 'bun run lint' to inspect diagnostics.\n");
    process.exit(35);
  }

  // 3. Fast typecheck with tsrs
  const typecheck = spawnSync('bun', ['run', 'typecheck'], {
    stdio: 'inherit',
  });

  if (typecheck.status !== 0) {
    console.error('\nPre-commit gate failed: Type errors detected by tsrs.');
    console.error("Run 'bun run typecheck' to inspect diagnostics.\n");
    process.exit(10);
  }
}

if (hasStagedNative) {
  console.log('[Pre-commit] Verifying staged native/ Rust crate(s)...');
  const cargoCheck = spawnSync('cargo', ['check', '--manifest-path', 'native/Cargo.toml'], {
    stdio: 'inherit',
  });
  if (cargoCheck.status !== 0) {
    console.error('\nPre-commit gate failed: cargo check failed in native/.');
    process.exit(45);
  }
}

console.log('[Pre-commit] All staged checks passed cleanly.');
process.exit(0);
