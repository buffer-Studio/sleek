import type {PlatformId} from '../../base/common/platformId';
import type {Result} from '../../base/common/result';

export interface InteractionPortError {
  readonly code: string;
  readonly message: string;
}

export interface InteractionPort {
  readonly replyInteraction: (options: {
    readonly platform: PlatformId;
    readonly interactionId: string;
    readonly interactionToken: string;
    readonly content: string;
    readonly ephemeral?: boolean;
  }) => Promise<Result<void, InteractionPortError>>;
  readonly deferInteraction: (options: {
    readonly platform: PlatformId;
    readonly interactionId: string;
    readonly interactionToken: string;
    readonly ephemeral?: boolean;
  }) => Promise<Result<void, InteractionPortError>>;
  readonly editOriginalResponse: (options: {
    readonly platform: PlatformId;
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }) => Promise<Result<void, InteractionPortError>>;
  readonly followUp: (options: {
    readonly platform: PlatformId;
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
    readonly ephemeral?: boolean;
  }) => Promise<Result<void, InteractionPortError>>;
}
