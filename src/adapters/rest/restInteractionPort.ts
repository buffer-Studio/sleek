import {err, ok, type Result} from '../../base/common/result';
import type {InteractionPort, InteractionPortError} from '../../core/ports/interaction.port';
import type {RestClient} from './restClient';
import {mapRestError} from './restMessagingRolePorts';

const EPHEMERAL_FLAG = 1 << 6;
const INTERACTION_ACK_TIMEOUT_MS = 2500;
const INTERACTION_FOLLOWUP_TIMEOUT_MS = 10_000;

export function createRestInteractionPort(restClient: RestClient): InteractionPort {
  return {
    replyInteraction: async (opts): Promise<Result<void, InteractionPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'POST',
        path: `/interactions/${opts.interactionId}/${opts.interactionToken}/callback`,
        routeKey: 'interactions/:id/:token/callback',
        majorParam: opts.interactionId,
        timeoutMs: INTERACTION_ACK_TIMEOUT_MS,
        isCritical: true,
        exemptGlobalRateLimit: true,
        body: {
          type: 4,
          data: {
            content: opts.content,
            flags: opts.ephemeral === true ? EPHEMERAL_FLAG : 0,
          },
        },
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    deferInteraction: async (opts): Promise<Result<void, InteractionPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'POST',
        path: `/interactions/${opts.interactionId}/${opts.interactionToken}/callback`,
        routeKey: 'interactions/:id/:token/callback',
        majorParam: opts.interactionId,
        timeoutMs: INTERACTION_ACK_TIMEOUT_MS,
        isCritical: true,
        exemptGlobalRateLimit: true,
        body: {
          type: 5,
          data: {
            flags: opts.ephemeral === true ? EPHEMERAL_FLAG : 0,
          },
        },
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    editOriginalResponse: async (opts): Promise<Result<void, InteractionPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'PATCH',
        path: `/webhooks/${opts.applicationId}/${opts.interactionToken}/messages/@original`,
        routeKey: 'webhooks/:id/:token/messages/@original',
        majorParam: opts.applicationId,
        timeoutMs: INTERACTION_FOLLOWUP_TIMEOUT_MS,
        isCritical: true,
        exemptGlobalRateLimit: true,
        body: {content: opts.content},
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    followUp: async (opts): Promise<Result<void, InteractionPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'POST',
        path: `/webhooks/${opts.applicationId}/${opts.interactionToken}`,
        routeKey: 'webhooks/:id/:token',
        majorParam: opts.applicationId,
        timeoutMs: INTERACTION_FOLLOWUP_TIMEOUT_MS,
        isCritical: true,
        exemptGlobalRateLimit: true,
        body: {
          content: opts.content,
          flags: opts.ephemeral === true ? EPHEMERAL_FLAG : 0,
        },
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
  };
}
