import type {PlatformId} from '../../../base/common/platformId';
import {ok, type Result} from '../../../base/common/result';
import type {BulkDeleteResult, ModerationPort, ModerationPortError} from '../moderation.port';

export interface ModerationActionCall {
  readonly action: 'ban' | 'unban' | 'kick' | 'timeout' | 'bulkDelete';
  readonly platform: PlatformId;
  readonly targetId: string;
  readonly reason: string;
  readonly deleteMessageSeconds?: number;
}

export interface FakeModerationPort extends ModerationPort {
  readonly calls: readonly ModerationActionCall[];
}

export function createFakeModerationPort(): FakeModerationPort {
  const calls: ModerationActionCall[] = [];

  return {
    calls,
    banMember: async (options): Promise<Result<void, ModerationPortError>> => {
      await Promise.resolve();
      calls.push({
        action: 'ban',
        platform: options.platform,
        targetId: options.userId,
        reason: options.reason,
        deleteMessageSeconds: options.deleteMessageSeconds,
      });
      return ok(undefined);
    },
    unbanMember: async (options): Promise<Result<void, ModerationPortError>> => {
      await Promise.resolve();
      calls.push({
        action: 'unban',
        platform: options.platform,
        targetId: options.userId,
        reason: options.reason,
      });
      return ok(undefined);
    },
    kickMember: async (options): Promise<Result<void, ModerationPortError>> => {
      await Promise.resolve();
      calls.push({
        action: 'kick',
        platform: options.platform,
        targetId: options.userId,
        reason: options.reason,
      });
      return ok(undefined);
    },
    timeoutMember: async (options): Promise<Result<void, ModerationPortError>> => {
      await Promise.resolve();
      calls.push({
        action: 'timeout',
        platform: options.platform,
        targetId: options.userId,
        reason: options.reason,
      });
      return ok(undefined);
    },
    bulkDeleteMessages: async (options): Promise<Result<BulkDeleteResult, ModerationPortError>> => {
      await Promise.resolve();
      calls.push({
        action: 'bulkDelete',
        platform: options.platform,
        targetId: options.channelId,
        reason: options.reason,
      });
      return ok({deletedCount: options.messageIds.length, skippedOldIds: []});
    },
  };
}
