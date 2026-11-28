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
    readonly components?: readonly unknown[];
  }) => Promise<Result<string, MessagingPortError>>;
  readonly editMessage: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly messageId: string;
    readonly content: string;
    readonly components?: readonly unknown[];
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
    readonly components?: readonly unknown[];
    readonly flags?: number;
  }) => Promise<Result<string, MessagingPortError>>;
  readonly createWebhook?: (options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly name: string;
  }) => Promise<Result<{readonly id: string; readonly token: string}, MessagingPortError>>;
  readonly executeWebhook?: (options: {
    readonly platform: PlatformId;
    readonly webhookId: string;
    readonly webhookToken: string;
    readonly content?: string;
    readonly embeds?: readonly unknown[];
    readonly components?: readonly unknown[];
  }) => Promise<Result<void, MessagingPortError>>;
}
