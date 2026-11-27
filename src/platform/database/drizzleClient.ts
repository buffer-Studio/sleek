import {drizzle, type PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type {AsyncDisposable} from '../../base/common/asyncDisposable';
import {createServiceKey} from '../di/serviceKey';

export interface ReadOnlySqlResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly truncated: boolean;
}

export interface DatabaseClient extends AsyncDisposable {
  readonly db: PostgresJsDatabase;
  readonly healthCheck: () => Promise<boolean>;
  readonly executeReadOnlySql: (
    query: string,
    timeoutMs: number,
    maxRows: number,
  ) => Promise<ReadOnlySqlResult>;
}

export const DATABASE_CLIENT_KEY = createServiceKey<DatabaseClient>('platform.database.client');

export interface CreateDrizzleClientOptions {
  readonly databaseUrl: string;
  readonly poolMax: number;
  readonly prepare: boolean;
}

function assertSingleReadOnlyStatement(rawQuery: string): string {
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) {
    throw new Error('SQL query cannot be empty.');
  }
  const withoutTrailingSemicolon = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed;
  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error('Multi-statement SQL queries are forbidden.');
  }
  return withoutTrailingSemicolon;
}

export function createDrizzleClient(options: CreateDrizzleClientOptions): DatabaseClient {
  const sql = postgres(options.databaseUrl, {
    max: options.poolMax,
    prepare: options.prepare,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(sql);

  return {
    db,
    healthCheck: async (): Promise<boolean> => {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    executeReadOnlySql: async (
      query: string,
      timeoutMs: number,
      maxRows: number,
    ): Promise<ReadOnlySqlResult> => {
      const statement = assertSingleReadOnlyStatement(query);
      const boundedTimeout = Math.max(100, Math.min(30_000, Math.trunc(timeoutMs)));
      const boundedRows = Math.max(1, Math.min(500, Math.trunc(maxRows)));

      const result = await sql.begin('READ ONLY', async tx => {
        await tx.unsafe(`SET LOCAL statement_timeout = '${boundedTimeout}ms'`);
        const rawRows = await tx.unsafe<Array<Record<string, unknown>>>(statement);
        const truncated = rawRows.length > boundedRows;
        const rows = truncated ? rawRows.slice(0, boundedRows) : [...rawRows];
        return {rows, truncated};
      });

      return result;
    },
    disposeAsync: async (): Promise<void> => {
      await sql.end({timeout: 5});
    },
  };
}
