import type {PlatformId} from '../../base/common/platformId';
import type {Result} from '../../base/common/result';

export interface MessagingPortError {
  readonly code: string;
  readonly message: string;
}

export interface MessagingPort {
  readonly sendMessage: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly content: string;
  }) => Promise<Result<string, MessagingPortError>>;
  readonly editMessage: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly messageId: string;
    readonly content: string;
  }) => Promise<Result<void, MessagingPortError>>;
  readonly deleteMessage: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly messageId: string;
    readonly reason?: string;
  }) => Promise<Result<void, MessagingPortError>>;
  readonly sendDirectMessage: (options: {
    readonly platform: PlatformId;
    readonly userId: string;
    readonly content: string;
  }) => Promise<Result<string, MessagingPortError>>;
}
