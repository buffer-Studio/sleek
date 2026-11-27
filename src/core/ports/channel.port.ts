import type {PlatformId} from '../../base/common/platformId';
import type {Result} from '../../base/common/result';

export interface ChannelPortError {
  readonly code: string;
  readonly message: string;
}

export interface ChannelSummary {
  readonly id: string;
  readonly guildId?: string;
  readonly type: number;
  readonly name?: string;
  readonly topic?: string;
}

export interface ChannelPort {
  readonly setChannelOverwrite: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly overwriteId: string;
    readonly targetType: 'role' | 'member';
    readonly allowBits: string;
    readonly denyBits: string;
    readonly reason: string;
  }) => Promise<Result<void, ChannelPortError>>;
  readonly deleteChannelOverwrite: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly overwriteId: string;
    readonly reason: string;
  }) => Promise<Result<void, ChannelPortError>>;
  readonly updateChannelTopic: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly topic: string;
    readonly reason: string;
  }) => Promise<Result<void, ChannelPortError>>;
  readonly fetchChannel: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
  }) => Promise<Result<ChannelSummary, ChannelPortError>>;
  readonly listGuildChannels: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
  }) => Promise<Result<readonly ChannelSummary[], ChannelPortError>>;
  readonly createChannel: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly name: string;
    readonly type?: number;
    readonly position?: number;
    readonly parentId?: string;
    readonly topic?: string;
    readonly permissionOverwrites?: ReadonlyArray<{
      readonly id: string;
      readonly type: 'role' | 'member';
      readonly allow: string;
      readonly deny: string;
    }>;
    readonly reason: string;
  }) => Promise<Result<ChannelSummary, ChannelPortError>>;
  readonly deleteChannel: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly reason: string;
  }) => Promise<Result<void, ChannelPortError>>;
  readonly createInvite: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly maxAgeSeconds?: number;
    readonly maxUses?: number;
    readonly unique?: boolean;
    readonly reason?: string;
  }) => Promise<Result<string, ChannelPortError>>;
}
