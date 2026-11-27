import type {PlatformId} from '../../../base/common/platformId';
import {ok, type Result} from '../../../base/common/result';
import type {MessagingPort, MessagingPortError} from '../messaging.port';

export interface SentMessageRecord {
  readonly kind: 'channel' | 'dm';
  readonly platform: PlatformId;
  readonly targetId: string;
  readonly content: string;
}

export interface EditedMessageRecord {
  readonly platform: PlatformId;
  readonly channelId: string;
  readonly messageId: string;
  readonly content: string;
}

export interface DeletedMessageRecord {
  readonly platform: PlatformId;
  readonly channelId: string;
  readonly messageId: string;
  readonly reason?: string;
}

export class FakeMessagingPort implements MessagingPort {
  public readonly sent: SentMessageRecord[] = [];
  public readonly edited: EditedMessageRecord[] = [];
  public readonly deleted: DeletedMessageRecord[] = [];
  private seq = 0;

  public async sendMessage(options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly content: string;
  }): Promise<Result<string, MessagingPortError>> {
    this.seq += 1;
    this.sent.push({
      kind: 'channel',
      platform: options.platform,
      targetId: options.channelId,
      content: options.content,
    });
    return Promise.resolve(ok(`msg_${this.seq}`));
  }

  public async editMessage(options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly messageId: string;
    readonly content: string;
  }): Promise<Result<void, MessagingPortError>> {
    this.edited.push({
      platform: options.platform,
      channelId: options.channelId,
      messageId: options.messageId,
      content: options.content,
    });
    return Promise.resolve(ok(undefined));
  }

  public async deleteMessage(options: {
    readonly platform: PlatformId;
    readonly channelId: string;
    readonly messageId: string;
    readonly reason?: string;
  }): Promise<Result<void, MessagingPortError>> {
    this.deleted.push({
      platform: options.platform,
      channelId: options.channelId,
      messageId: options.messageId,
      reason: options.reason,
    });
    return Promise.resolve(ok(undefined));
  }

  public async sendDirectMessage(options: {
    readonly platform: PlatformId;
    readonly userId: string;
    readonly content: string;
  }): Promise<Result<string, MessagingPortError>> {
    this.seq += 1;
    this.sent.push({
      kind: 'dm',
      platform: options.platform,
      targetId: options.userId,
      content: options.content,
    });
    return Promise.resolve(ok(`dm_${this.seq}`));
  }
}
