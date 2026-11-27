import {appendFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLoggerOptions {
  readonly minLevel?: LogLevel;
  readonly logFilePath?: string;
  readonly prettyConsole?: boolean;
  readonly writeStdout?: (line: string) => void;
}

export interface StructuredLogger {
  readonly logFilePath?: string;
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
}

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function formatConsoleValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}

function formatPrettyConsoleLine(
  ts: string,
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): string {
  const time = ts.slice(11, 19);
  const lvl = level.toUpperCase().padEnd(5, ' ');
  const cluster =
    fields !== undefined && typeof fields.clusterId === 'string' ? `[${fields.clusterId}] ` : '';
  const pairs: string[] = [];
  if (fields !== undefined) {
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'clusterId' || value === undefined) {
        continue;
      }
      pairs.push(`${key}=${formatConsoleValue(value)}`);
    }
  }
  const suffix = pairs.length > 0 ? `  ${pairs.join(' ')}` : '';
  return `${time} ${lvl} ${cluster}${event}${suffix}\n`;
}

export function createRunLogFilePath(
  cwd: string = process.cwd(),
  clusterId = 'C0',
  now: Date = new Date(),
  pid: number = process.pid,
): string {
  const dir = join(cwd, 'logs', 'runs');
  mkdirSync(dir, {recursive: true});
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(dir, `sleek-${clusterId}-${stamp}-pid${pid}.log`);
}

export function createStructuredLogger(
  minLevelOrOptions: LogLevel | StructuredLoggerOptions = 'info',
): StructuredLogger {
  const options: StructuredLoggerOptions =
    typeof minLevelOrOptions === 'string' ? {minLevel: minLevelOrOptions} : minLevelOrOptions;
  const minLevel = options.minLevel ?? 'info';
  const threshold = LOG_PRIORITY[minLevel];
  const logFilePath = options.logFilePath;
  const prettyConsole = options.prettyConsole ?? false;
  const writeStdout =
    options.writeStdout ??
    ((line: string): void => {
      process.stdout.write(line);
    });

  function emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LOG_PRIORITY[level] < threshold) {
      return;
    }
    const ts = new Date().toISOString();
    const record = {
      ts,
      level,
      event,
      ...fields,
    };

    if (prettyConsole) {
      writeStdout(formatPrettyConsoleLine(ts, level, event, fields));
    } else {
      writeStdout(`${JSON.stringify(record)}\n`);
    }

    if (logFilePath !== undefined) {
      const paddedLevel = level.toUpperCase().padEnd(5, ' ');
      const detail = fields !== undefined ? ` ${JSON.stringify(fields)}` : '';
      appendFileSync(logFilePath, `[${ts}] ${paddedLevel} ${event}${detail}\n`, 'utf-8');
    }
  }

  return {
    logFilePath,
    debug: (event: string, fields?: Record<string, unknown>): void => {
      emit('debug', event, fields);
    },
    info: (event: string, fields?: Record<string, unknown>): void => {
      emit('info', event, fields);
    },
    warn: (event: string, fields?: Record<string, unknown>): void => {
      emit('warn', event, fields);
    },
    error: (event: string, fields?: Record<string, unknown>): void => {
      emit('error', event, fields);
    },
  };
}
