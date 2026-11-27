import {describe, expect, it} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {createRunLogFilePath, createStructuredLogger} from './structuredLogger';

describe('StructuredLogger', () => {
  it('writes compact pretty console lines and full structured lines to logs/runs', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sleek-log-test-'));
    try {
      const pathA = createRunLogFilePath(tempDir, 'C0', new Date('2026-11-26T10:00:00.000Z'), 101);
      const pathB = createRunLogFilePath(tempDir, 'C1', new Date('2026-11-26T10:00:01.000Z'), 102);
      const stdoutLines: string[] = [];

      const logger = createStructuredLogger({
        minLevel: 'debug',
        logFilePath: pathA,
        prettyConsole: true,
        writeStdout: line => {
          stdoutLines.push(line);
        },
      });

      logger.info('sleek.startup', {clusterId: 'C0', runtimeMode: 'allInOne'});
      logger.debug('discord.gateway.dispatch', {clusterId: 'C0', eventType: 'MESSAGE_CREATE'});

      const content = readFileSync(pathA, 'utf-8');
      expect(pathA).toContain(join('logs', 'runs', 'sleek-C0-'));
      expect(pathB).toContain(join('logs', 'runs', 'sleek-C1-'));
      expect(pathA).not.toBe(pathB);
      expect(stdoutLines[0]).toContain('INFO  [C0] sleek.startup  runtimeMode=allInOne');
      expect(content).toContain('INFO  sleek.startup {"clusterId":"C0","runtimeMode":"allInOne"}');
      expect(content).toContain(
        'DEBUG discord.gateway.dispatch {"clusterId":"C0","eventType":"MESSAGE_CREATE"}',
      );
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });
});
