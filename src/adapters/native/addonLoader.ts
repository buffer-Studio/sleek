import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';

import {err, ok, type Result} from '../../base/common/result';

export interface NativeGatewayBatchEvent {
  readonly platform: string;
  readonly shardId: number;
  readonly eventType: string;
  readonly rawJson: string;
}

export interface NativeGatewayBatch {
  readonly events: readonly NativeGatewayBatchEvent[];
  readonly droppedCount: number;
}

export interface NativeIdentifyRequest {
  readonly platform: string;
  readonly shardId: number;
}

export interface NativeGatewayConfig {
  readonly discordToken?: string;
  readonly discordIntents?: number;
  readonly discordShardStart?: number;
  readonly discordShardEnd?: number;
  readonly discordTotalShards?: number;
  readonly fluxerToken?: string;
  readonly fluxerWsUrl?: string;
  readonly fluxerShardStart?: number;
  readonly fluxerShardEnd?: number;
  readonly fluxerTotalShards?: number;
  readonly interestMask?: number;
}

export interface NativeGatewayCluster {
  start: (
    config: NativeGatewayConfig,
    onBatch: (error: unknown, batch: NativeGatewayBatch) => void,
    onIdentifyRequest?: (error: unknown, req: NativeIdentifyRequest) => void,
  ) => void;
  setEventInterest: (mask: number) => void;
  grantIdentify: (platform: string, shardId: number) => void;
  stop: (timeoutMs?: number) => void;
}

export interface NativeGatewayAddon {
  readonly GatewayCluster: new () => NativeGatewayCluster;
  readonly shutdownNativeRuntime: (timeoutMs?: number) => void;
}

export interface AddonLoadError {
  readonly code: 'ADDON_LOAD_FAILED' | 'ADDON_INVALID_SHAPE';
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidAddon(mod: unknown): mod is NativeGatewayAddon {
  if (!isRecord(mod)) {
    return false;
  }
  const cluster = mod['GatewayCluster'];
  const shutdown = mod['shutdownNativeRuntime'];
  if (typeof cluster !== 'function' || typeof shutdown !== 'function') {
    return false;
  }
  const proto: unknown = cluster.prototype;
  if (!isRecord(proto)) {
    return false;
  }
  return (
    typeof proto['start'] === 'function' &&
    typeof proto['setEventInterest'] === 'function' &&
    typeof proto['stop'] === 'function'
  );
}

export function resolveAddonPath(cwd: string = process.cwd()): string {
  const platformTag = `${process.platform}-${process.arch}`;
  const candidates = [
    `sleek_napi.${platformTag}-msvc.node`,
    `sleek_napi.${platformTag}-gnu.node`,
    `sleek_napi.${platformTag}.node`,
    `index.${platformTag}-msvc.node`,
    `index.${platformTag}-gnu.node`,
    `index.${platformTag}.node`,
  ];
  for (const name of candidates) {
    const candidatePath = join(cwd, 'native', name);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return join(cwd, 'native', `sleek_napi.${platformTag}.node`);
}

export function loadNativeAddon(
  addonPath: string = resolveAddonPath(),
): Result<NativeGatewayAddon, AddonLoadError> {
  const requireFn: (id: string) => unknown = createRequire(import.meta.url);
  try {
    const loaded = requireFn(addonPath);
    if (!isValidAddon(loaded)) {
      return err({
        code: 'ADDON_INVALID_SHAPE',
        message: `Native addon at ${addonPath} is missing GatewayCluster or shutdownNativeRuntime`,
      });
    }
    return ok(loaded);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err({
      code: 'ADDON_LOAD_FAILED',
      message: `Failed to load native addon at ${addonPath}: ${message}`,
    });
  }
}
