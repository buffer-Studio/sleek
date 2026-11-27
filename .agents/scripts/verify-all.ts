/**
 * Comprehensive verification runner for pre-push and CI pipelines.
 * Executes discrete verification stages with exact error codes and telemetry.
 */

import {spawnSync} from 'node:child_process';
import {mkdirSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';

interface StageResult {
  readonly name: string;
  readonly code: number;
  readonly durationMs: number;
  readonly output: string;
}

const logDir = join(process.cwd(), '.agents', 'logs');
mkdirSync(logDir, {recursive: true});
const logFile = join(logDir, 'verify.log');

function logToFile(msg: string): void {
  const timestamp = new Date().toISOString();
  appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
}

function runStage(
  name: string,
  command: string,
  args: readonly string[],
  errorCode: number,
): StageResult {
  const start = performance.now();
  console.log(`\n========================================`);
  console.log(`▶ STAGE: ${name}`);
  console.log(`========================================`);

  const proc = spawnSync(command, args, {encoding: 'utf-8'});
  const durationMs = Math.round(performance.now() - start);
  const combinedOutput = `${proc.stdout}\n${proc.stderr}`;

  if (proc.status === 0) {
    console.log(proc.stdout);
    console.log(`✔ [STAGE: ${name}] Passed in ${durationMs}ms`);
    logToFile(`PASS: ${name} (${durationMs}ms)`);
    return {name, code: 0, durationMs, output: combinedOutput};
  }

  console.error(proc.stderr || proc.stdout);
  console.error(`✖ [STAGE: ${name}] Failed with exit code ${errorCode} in ${durationMs}ms`);
  logToFile(`FAIL: ${name} (exit ${errorCode}, ${durationMs}ms)`);
  return {name, code: errorCode, durationMs, output: combinedOutput};
}

function verifyAll(): void {
  const tsOnly = process.argv.includes('--ts-only');
  const totalStart = performance.now();
  console.log(`Starting ${tsOnly ? 'TypeScript-only' : 'full'} Sleek repository verification...\n`);
  logToFile(`Starting verify-all run (tsOnly=${String(tsOnly)})`);

  // Stage 1: tsrs Type Checking
  const typecheck = runStage('tsrs typecheck', 'bun', ['run', 'typecheck'], 10);
  if (typecheck.code !== 0) {
    console.error('\nVerification halted at Stage 1 (tsrs typecheck).');
    process.exit(10);
  }

  // Stage 2: Google TypeScript Style (GTS) Validation
  const gts = runStage('GTS style validation', 'bun', ['run', '.agents/scripts/check-gts.ts'], 30);
  if (gts.code !== 0) {
    console.error('\nVerification halted at Stage 2 (GTS style validation).');
    process.exit(30);
  }

  // Stage 3: Architectural Boundary Validation
  const boundaries = runStage(
    'Boundary check',
    'bun',
    ['run', '.agents/scripts/check-boundaries.ts'],
    31,
  );
  if (boundaries.code !== 0) {
    console.error('\nVerification halted at Stage 3 (Boundary check).');
    process.exit(31);
  }

  // Stage 4: Ultra Type-Strict ESLint Verification
  const eslint = runStage('ESLint strict check', 'bun', ['run', 'lint'], 35);
  if (eslint.code !== 0) {
    console.error('\nVerification halted at Stage 4 (ESLint strict check).');
    process.exit(35);
  }

  // Stage 5: Prettier Format Verification
  const prettier = runStage('Prettier format check', 'bun', ['run', 'format:check'], 36);
  if (prettier.code !== 0) {
    console.error('\nVerification halted at Stage 5 (Prettier format check).');
    process.exit(36);
  }

  // Stage 6: Bun Test Suite
  const tests = runStage('bun test', 'bun', ['test'], 40);
  if (tests.code !== 0) {
    console.error('\nVerification halted at Stage 6 (bun test).');
    process.exit(40);
  }

  if (!tsOnly) {
    // Stage 7: Rust Native Workspace Check & Tests
    const cargoCheck = runStage(
      'cargo check (native)',
      'cargo',
      ['check', '--manifest-path', 'native/Cargo.toml'],
      45,
    );
    if (cargoCheck.code !== 0) {
      console.error('\nVerification halted at Stage 7 (cargo check).');
      process.exit(45);
    }

    const cargoTest = runStage(
      'cargo test (native)',
      'cargo',
      ['test', '--manifest-path', 'native/Cargo.toml'],
      45,
    );
    if (cargoTest.code !== 0) {
      console.error('\nVerification halted at Stage 8 (cargo test).');
      process.exit(45);
    }
  }

  const totalDuration = Math.round(performance.now() - totalStart);
  console.log(`\n========================================`);
  console.log(`✔ All stages passed cleanly in ${totalDuration}ms`);
  console.log(`========================================\n`);
  logToFile(`COMPLETE: All stages passed (${totalDuration}ms)`);
  process.exit(0);
}

verifyAll();
