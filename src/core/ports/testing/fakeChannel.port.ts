import type {PlatformId} from '../../../base/common/platformId';
import {err, ok, type Result} from '../../../base/common/result';
import type {ChannelPort, ChannelPortError, ChannelSummary} from '../channel.port';

export interface FakeChannelPort extends ChannelPort {
  readonly channels: Map<string, ChannelSummary>;
  readonly overwrites: Map<
    string,
    {
      readonly allowBits: string;
      readonly denyBits: string;
      readonly targetType: 'role' | 'member';
    }
  >;
  readonly createdInvites: ReadonlyArray<{
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly code: string;
  }>;
  setCreateInviteFailure: (error: ChannelPortError | undefined) => void;
}

export function createFakeChannelPort(): FakeChannelPort {
  const channels = new Map<string, ChannelSummary>();
  const overwrites = new Map<
    string,
    {
      readonly allowBits: string;
      readonly denyBits: string;
      readonly targetType: 'role' | 'member';
    }
  >();
  const createdInvites: Array<{
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly code: string;
  }> = [];
  let channelSeq = 0;
  let inviteSeq = 0;
  let inviteFailure: ChannelPortError | undefined;

  return {
    channels,
    overwrites,
    createdInvites,
    setCreateInviteFailure: (error: ChannelPortError | undefined): void => {
      inviteFailure = error;
    },
    setChannelOverwrite: async (options): Promise<Result<void, ChannelPortError>> => {
      await Promise.resolve();
      overwrites.set(`${options.channelId}:${options.overwriteId}`, {
        allowBits: options.allowBits,
        denyBits: options.denyBits,
        targetType: options.targetType,
      });
      return ok(undefined);
    },
    deleteChannelOverwrite: async (): Promise<Result<void, ChannelPortError>> => {
      await Promise.resolve();
      return ok(undefined);
    },
    updateChannelTopic: async (options: {
      readonly platform: PlatformId;
      readonly channelId: string;
      readonly topic: string;
      readonly reason: string;
    }): Promise<Result<void, ChannelPortError>> => {
      await Promise.resolve();
      const existing = channels.get(options.channelId);
      if (existing !== undefined) {
        channels.set(options.channelId, {...existing, topic: options.topic});
      } else {
        channels.set(options.channelId, {
          id: options.channelId,
          type: 0,
          topic: options.topic,
        });
      }
      return ok(undefined);
    },
    fetchChannel: async (options: {
      readonly platform: PlatformId;
      readonly channelId: string;
    }): Promise<Result<ChannelSummary, ChannelPortError>> => {
      await Promise.resolve();
      const found = channels.get(options.channelId);
      if (found === undefined) {
        return err({code: 'not_found', message: 'Channel not found'});
      }
      return ok(found);
    },
    listGuildChannels: async (options: {
      readonly platform: PlatformId;
      readonly guildId: string;
    }): Promise<Result<readonly ChannelSummary[], ChannelPortError>> => {
      await Promise.resolve();
      const matched = [...channels.values()].filter(ch => ch.guildId === options.guildId);
      return ok(matched);
    },
    createChannel: async (options): Promise<Result<ChannelSummary, ChannelPortError>> => {
      await Promise.resolve();
      channelSeq += 1;
      const id = `333333333333339${String(channelSeq).padStart(3, '0')}`;
      const summary: ChannelSummary = {
        id,
        guildId: options.guildId,
        type: options.type ?? 0,
        name: options.name,
        topic: options.topic,
      };
      channels.set(id, summary);
      for (const overwrite of options.permissionOverwrites ?? []) {
        overwrites.set(`${id}:${overwrite.id}`, {
          allowBits: overwrite.allow,
          denyBits: overwrite.deny,
          targetType: overwrite.type,
        });
      }
      return ok(summary);
    },
    deleteChannel: async (options): Promise<Result<void, ChannelPortError>> => {
      await Promise.resolve();
      const existed = channels.delete(options.channelId);
      if (!existed) {
        return err({code: 'not_found', message: 'Channel not found'});
      }
      for (const key of [...overwrites.keys()]) {
        if (key.startsWith(`${options.channelId}:`)) {
          overwrites.delete(key);
        }
      }
      return ok(undefined);
    },
    createInvite: async (options: {
      readonly platform: PlatformId;
      readonly channelId: string;
      readonly maxAgeSeconds?: number;
      readonly maxUses?: number;
      readonly unique?: boolean;
      readonly reason?: string;
    }): Promise<Result<string, ChannelPortError>> => {
      await Promise.resolve();
      if (inviteFailure !== undefined) {
        return err(inviteFailure);
      }
      inviteSeq += 1;
      const code = `sleek${inviteSeq}`;
      createdInvites.push({
        platform: options.platform,
        channelId: options.channelId,
        code,
      });
      return ok(code);
    },
  };
}
