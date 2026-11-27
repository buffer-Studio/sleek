import type {PlatformId} from '../../base/common/platformId';
import type {Result} from '../../base/common/result';

export interface ModerationPortError {
  readonly code: string;
  readonly message: string;
}

export interface BulkDeleteResult {
  readonly deletedCount: number;
  readonly skippedOldIds: readonly string[];
}

export interface ModerationPort {
  readonly banMember: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly deleteMessageSeconds?: number;
    readonly reason: string;
  }) => Promise<Result<void, ModerationPortError>>;
  readonly unbanMember: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly reason: string;
  }) => Promise<Result<void, ModerationPortError>>;
  readonly kickMember: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly reason: string;
  }) => Promise<Result<void, ModerationPortError>>;
  readonly timeoutMember: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly untilIso: string | undefined;
    readonly reason: string;
  }) => Promise<Result<void, ModerationPortError>>;
  readonly bulkDeleteMessages: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly messageIds: readonly string[];
    readonly reason: string;
  }) => Promise<Result<BulkDeleteResult, ModerationPortError>>;
}
