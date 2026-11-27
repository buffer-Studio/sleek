import {z} from 'zod';

import type {Disposable} from '../../base/common/disposable';
import type {PlatformId} from '../../base/common/platformId';
import {err, ok, type Result} from '../../base/common/result';
import type {ValkeyClient} from '../../platform/cache/valkeyClient';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';
import {RateLimitBucketStore} from './rateLimitBucketStore';
import type {RestError, RestErrorCode, RestRequestOptions} from './restTypes';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 2;

export interface RestClient extends Disposable {
  readonly request: <T>(options: RestRequestOptions) => Promise<Result<T, RestError>>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CreateRestClientOptions {
  readonly discordToken?: string;
  readonly fluxerToken?: string;
  readonly fluxerApiBaseUrl: string;
  readonly valkey?: ValkeyClient;
  readonly logger?: StructuredLogger;
  readonly fetchFn?: FetchLike;
  readonly bucketStore?: RateLimitBucketStore;
  readonly sleepMs?: (ms: number) => Promise<void>;
}

const restErrorBodySchema = z.object({
  retry_after: z.number().positive().optional(),
  global: z.boolean().optional(),
  code: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional(),
});

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

function isInteractionExemptRoute(routeKey: string): boolean {
  return routeKey.startsWith('interactions/') || routeKey.startsWith('webhooks/');
}

function mapStatusToErrorCode(status: number): RestErrorCode {
  if (status === 401) {
    return 'unauthorized';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 400 && status < 500) {
    return 'bad_request';
  }
  return 'server_error';
}

function parseRetryAfterMs(headers: Headers, bodyObj: unknown): number {
  const resetAfter = headers.get('x-ratelimit-reset-after');
  if (resetAfter !== null) {
    const parsed = Number(resetAfter);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.ceil(parsed * 1000);
    }
  }
  const retryAfterHeader = headers.get('retry-after');
  if (retryAfterHeader !== null) {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.ceil(parsed * 1000);
    }
  }
  const parsedBody = restErrorBodySchema.safeParse(bodyObj);
  if (parsedBody.success && parsedBody.data.retry_after !== undefined) {
    return Math.ceil(parsedBody.data.retry_after * 1000);
  }
  return 1000;
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createRestClient(options: CreateRestClientOptions): RestClient {
  const fetchImpl = options.fetchFn ?? fetch;
  const sleepImpl = options.sleepMs ?? defaultSleep;
  const bucketStore =
    options.bucketStore ??
    new RateLimitBucketStore({
      valkey: options.valkey,
      logger: options.logger,
      sleepMs: sleepImpl,
    });

  void bucketStore.initValkeySync();

  function getAuthAndBaseUrl(
    platform: PlatformId,
  ): {readonly token: string; readonly baseUrl: string} | undefined {
    if (platform === 'discord') {
      if (options.discordToken === undefined || options.discordToken.length === 0) {
        return undefined;
      }
      return {token: options.discordToken, baseUrl: DISCORD_API_BASE_URL};
    }
    if (options.fluxerToken === undefined || options.fluxerToken.length === 0) {
      return undefined;
    }
    return {
      token: options.fluxerToken,
      baseUrl: options.fluxerApiBaseUrl.replace(/\/+$/, ''),
    };
  }

  return {
    request: async <T>(req: RestRequestOptions): Promise<Result<T, RestError>> => {
      const auth = getAuthAndBaseUrl(req.platform);
      if (auth === undefined) {
        return err({
          code: 'unauthorized',
          message: `Missing bot token for platform '${req.platform}'`,
        });
      }

      const isCritical = req.isCritical ?? isInteractionExemptRoute(req.routeKey);
      if (bucketStore.isCircuitOpen(req.platform, isCritical)) {
        return err({
          code: 'circuit_open',
          message: `Invalid-request circuit breaker open for platform '${req.platform}'`,
        });
      }

      const majorParam = req.majorParam ?? 'global';
      const exemptGlobalRateLimit =
        req.exemptGlobalRateLimit ?? isInteractionExemptRoute(req.routeKey);

      for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
        const result = await bucketStore.acquireSlot(
          {
            platform: req.platform,
            routeKey: req.routeKey,
            majorParam,
            exemptGlobalRateLimit,
          },
          async (): Promise<{
            readonly retryMs?: number;
            readonly outcome: Result<T, RestError>;
          }> => {
            const headers: Record<string, string> = {
              Authorization: `Bot ${auth.token}`,
            };
            if (req.body !== undefined) {
              headers['Content-Type'] = 'application/json';
            }
            if (req.auditLogReason !== undefined && req.auditLogReason.length > 0) {
              headers['X-Audit-Log-Reason'] = encodeURIComponent(req.auditLogReason);
            }

            let response: Response;
            try {
              const normalizedPath = req.path.startsWith('/') ? req.path : `/${req.path}`;
              response = await fetchImpl(`${auth.baseUrl}${normalizedPath}`, {
                method: req.method,
                headers,
                body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
                signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
              });
            } catch (error: unknown) {
              return {
                outcome: err({
                  code: 'network_error',
                  message: error instanceof Error ? error.message : String(error),
                }),
              };
            }

            bucketStore.updateFromHeaders(req.platform, req.routeKey, majorParam, response.headers);

            if (response.ok) {
              if (response.status === 204) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                return {outcome: ok(undefined as T)};
              }
              const parsedBody = await safeParseJson(response);
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              return {outcome: ok(parsedBody as T)};
            }

            bucketStore.recordInvalidStatus(req.platform, response.status);
            const errorBody = await safeParseJson(response);
            const parsedErrorBody = restErrorBodySchema.safeParse(errorBody);

            if (response.status === 429) {
              const retryAfterMs = parseRetryAfterMs(response.headers, errorBody);
              const scope = response.headers.get('x-ratelimit-scope');
              const isGlobalBody = parsedErrorBody.success && parsedErrorBody.data.global === true;
              if (scope === 'global' || isGlobalBody) {
                bucketStore.notifyGlobalPause(req.platform, retryAfterMs);
              }
              if (attempt < MAX_RATE_LIMIT_RETRIES) {
                return {
                  retryMs: retryAfterMs,
                  outcome: err({
                    code: 'rate_limited',
                    status: 429,
                    retryAfterMs,
                    message: 'Rate limited',
                  }),
                };
              }
              return {
                outcome: err({
                  code: 'rate_limited',
                  status: 429,
                  retryAfterMs,
                  message: `Rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES} retries`,
                }),
              };
            }

            const apiCode = parsedErrorBody.success ? parsedErrorBody.data.code : undefined;
            const bodyMessage = parsedErrorBody.success ? parsedErrorBody.data.message : undefined;

            return {
              outcome: err({
                code: mapStatusToErrorCode(response.status),
                status: response.status,
                apiCode,
                message:
                  bodyMessage ?? `REST ${req.method} ${req.path} failed with ${response.status}`,
              }),
            };
          },
        );

        if (result.retryMs !== undefined) {
          await sleepImpl(result.retryMs);
          continue;
        }
        return result.outcome;
      }

      return err({
        code: 'rate_limited',
        status: 429,
        message: 'Rate limit retries exhausted',
      });
    },
    dispose: (): void => {
      bucketStore.dispose();
    },
  };
}
