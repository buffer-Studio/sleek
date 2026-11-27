import type {PlatformId} from '../../base/common/platformId';

export type {PlatformId};

export const EVENT_INTEREST = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 2,
  MESSAGE_CONTENT: 1 << 3,
  INTERACTIONS: 1 << 4,
  VOICE_STATE: 1 << 5,
  REACTIONS: 1 << 6,
  LIFECYCLE: 1 << 7,
} as const;

export const DEFAULT_EVENT_INTEREST =
  EVENT_INTEREST.GUILDS |
  EVENT_INTEREST.GUILD_MESSAGES |
  EVENT_INTEREST.MESSAGE_CONTENT |
  EVENT_INTEREST.INTERACTIONS |
  EVENT_INTEREST.LIFECYCLE;

export interface GatewayBatchEvent {
  readonly platform: PlatformId;
  readonly shardId: number;
  readonly eventType: string;
  readonly rawJson: string;
}

export interface GatewayBatch {
  readonly events: readonly GatewayBatchEvent[];
  readonly droppedCount: number;
}

export interface IdentifyRequestEvent {
  readonly platform: PlatformId;
  readonly shardId: number;
}

export interface GatewayStartConfig {
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

export interface GatewayPort {
  start: (
    config: GatewayStartConfig,
    onBatch: (batch: GatewayBatch) => void,
    onIdentifyRequest?: (req: IdentifyRequestEvent) => void,
  ) => void;
  setEventInterest: (mask: number) => void;
  grantIdentify: (platform: PlatformId, shardId: number) => void;
  stop: (timeoutMs?: number) => void;
}
