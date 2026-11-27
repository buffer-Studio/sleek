import type {PlatformId} from '../../../base/common/platformId';
import {err, ok, type Result} from '../../../base/common/result';
import type {InteractionPort, InteractionPortError} from '../interaction.port';

export interface SentInteractionReply {
  readonly kind: 'reply' | 'defer' | 'edit' | 'followUp';
  readonly platform: PlatformId;
  readonly content?: string;
  readonly ephemeral?: boolean;
}

export interface FakeInteractionPort extends InteractionPort {
  readonly replies: readonly SentInteractionReply[];
}

export function createFakeInteractionPort(): FakeInteractionPort {
  const replies: SentInteractionReply[] = [];

  return {
    replies,
    replyInteraction: async (options): Promise<Result<void, InteractionPortError>> => {
      await Promise.resolve();
      if (options.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
      replies.push({
        kind: 'reply',
        platform: options.platform,
        content: options.content,
        ephemeral: options.ephemeral,
      });
      return ok(undefined);
    },
    deferInteraction: async (options): Promise<Result<void, InteractionPortError>> => {
      await Promise.resolve();
      if (options.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
      replies.push({
        kind: 'defer',
        platform: options.platform,
        ephemeral: options.ephemeral,
      });
      return ok(undefined);
    },
    editOriginalResponse: async (options): Promise<Result<void, InteractionPortError>> => {
      await Promise.resolve();
      if (options.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
      replies.push({
        kind: 'edit',
        platform: options.platform,
        content: options.content,
      });
      return ok(undefined);
    },
    followUp: async (options): Promise<Result<void, InteractionPortError>> => {
      await Promise.resolve();
      if (options.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
      replies.push({
        kind: 'followUp',
        platform: options.platform,
        content: options.content,
        ephemeral: options.ephemeral,
      });
      return ok(undefined);
    },
  };
}
