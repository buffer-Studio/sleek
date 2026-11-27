import type {PlatformId} from '../../base/common/platformId';

export type RestErrorCode =
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'server_error'
  | 'network_error'
  | 'unsupported_platform'
  | 'circuit_open';

export interface RestError {
  readonly code: RestErrorCode;
  readonly status?: number;
  readonly message: string;
  readonly retryAfterMs?: number;
  readonly apiCode?: number | string;
}

export type RestHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RestRequestOptions {
  readonly platform: PlatformId;
  readonly method: RestHttpMethod;
  readonly path: string;
  readonly routeKey: string;
  readonly majorParam?: string;
  readonly body?: unknown;
  readonly auditLogReason?: string;
  readonly timeoutMs?: number;
  readonly isCritical?: boolean;
  readonly exemptGlobalRateLimit?: boolean;
}
