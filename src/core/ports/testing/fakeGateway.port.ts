import type {
  GatewayBatch,
  GatewayPort,
  GatewayStartConfig,
  IdentifyRequestEvent,
  PlatformId,
} from '../gateway.port';

export interface FakeGatewayController extends GatewayPort {
  readonly startedConfigs: GatewayStartConfig[];
  readonly interestHistory: number[];
  readonly grantedIdentifies: IdentifyRequestEvent[];
  readonly stopCalls: number[];
  emitBatch: (batch: GatewayBatch) => void;
}

export function createFakeGatewayPort(): FakeGatewayController {
  const startedConfigs: GatewayStartConfig[] = [];
  const interestHistory: number[] = [];
  const grantedIdentifies: IdentifyRequestEvent[] = [];
  const stopCalls: number[] = [];
  let activeHandler: ((batch: GatewayBatch) => void) | undefined;

  return {
    startedConfigs,
    interestHistory,
    grantedIdentifies,
    stopCalls,
    start: (config: GatewayStartConfig, onBatch: (batch: GatewayBatch) => void): void => {
      startedConfigs.push(config);
      activeHandler = onBatch;
    },
    setEventInterest: (mask: number): void => {
      interestHistory.push(mask);
    },
    grantIdentify: (platform: PlatformId, shardId: number): void => {
      grantedIdentifies.push({platform, shardId});
    },
    stop: (timeoutMs = 3000): void => {
      stopCalls.push(timeoutMs);
      activeHandler = undefined;
    },
    emitBatch: (batch: GatewayBatch): void => {
      if (activeHandler !== undefined) {
        activeHandler(batch);
      }
    },
  };
}
