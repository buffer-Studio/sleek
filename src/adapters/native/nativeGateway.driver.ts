import type {
  GatewayBatch,
  GatewayBatchEvent,
  GatewayPort,
  GatewayStartConfig,
  IdentifyRequestEvent,
  PlatformId,
} from '../../core/ports/gateway.port';
import type {NativeGatewayAddon, NativeGatewayCluster} from './addonLoader';

function toPlatformId(raw: string): PlatformId {
  return raw === 'fluxer' ? 'fluxer' : 'discord';
}

export function createNativeGatewayDriver(addon: NativeGatewayAddon): GatewayPort {
  let cluster: NativeGatewayCluster | undefined;

  return {
    start: (
      config: GatewayStartConfig,
      onBatch: (batch: GatewayBatch) => void,
      onIdentifyRequest?: (req: IdentifyRequestEvent) => void,
    ): void => {
      if (cluster !== undefined) {
        throw new Error('NativeGatewayDriver is already started');
      }
      const instance = new addon.GatewayCluster();
      cluster = instance;
      const identifyHandler =
        onIdentifyRequest !== undefined
          ? (error: unknown, req: {readonly platform: string; readonly shardId: number}): void => {
              if (error !== null && error !== undefined) {
                return;
              }
              onIdentifyRequest({
                platform: toPlatformId(req.platform),
                shardId: req.shardId,
              });
            }
          : undefined;

      instance.start(
        {
          discordToken: config.discordToken,
          discordIntents: config.discordIntents,
          discordShardStart: config.discordShardStart,
          discordShardEnd: config.discordShardEnd,
          discordTotalShards: config.discordTotalShards,
          fluxerToken: config.fluxerToken,
          fluxerWsUrl: config.fluxerWsUrl,
          fluxerShardStart: config.fluxerShardStart,
          fluxerShardEnd: config.fluxerShardEnd,
          fluxerTotalShards: config.fluxerTotalShards,
          interestMask: config.interestMask,
        },
        (error: unknown, nativeBatch) => {
          if (error !== null && error !== undefined) {
            return;
          }
          const events: GatewayBatchEvent[] = nativeBatch.events.map(event => ({
            platform: toPlatformId(event.platform),
            shardId: event.shardId,
            eventType: event.eventType,
            rawJson: event.rawJson,
          }));
          onBatch({
            events,
            droppedCount: nativeBatch.droppedCount,
          });
        },
        identifyHandler,
      );
    },
    setEventInterest: (mask: number): void => {
      if (cluster !== undefined) {
        cluster.setEventInterest(mask);
      }
    },
    grantIdentify: (platform: PlatformId, shardId: number): void => {
      if (cluster !== undefined) {
        cluster.grantIdentify(platform, shardId);
      }
    },
    stop: (timeoutMs = 3000): void => {
      if (cluster !== undefined) {
        cluster.stop(timeoutMs);
        cluster = undefined;
      }
      addon.shutdownNativeRuntime(timeoutMs);
    },
  };
}
