import {err, ok, type Result} from '../../base/common/result';
import type {
  BulkDeleteResult,
  ModerationPort,
  ModerationPortError,
} from '../../core/ports/moderation.port';
import type {RestClient} from './restClient';
import {mapRestError} from './restMessagingRolePorts';

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const FOURTEEN_DAYS_MS = 14 * 86_400_000;

function snowflakeTimestampMs(id: string): number | undefined {
  try {
    const raw = BigInt(id);
    return Number((raw >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return undefined;
  }
}

export function createRestModerationPort(
  restClient: RestClient,
  nowMs: () => number,
): ModerationPort {
  return {
    banMember: async (opts): Promise<Result<void, ModerationPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'PUT',
        path: `/guilds/${opts.guildId}/bans/${opts.userId}`,
        routeKey: 'guilds/:guildId/bans/:userId',
        majorParam: opts.guildId,
        body:
          opts.deleteMessageSeconds !== undefined
            ? {delete_message_seconds: opts.deleteMessageSeconds}
            : {},
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    unbanMember: async (opts): Promise<Result<void, ModerationPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'DELETE',
        path: `/guilds/${opts.guildId}/bans/${opts.userId}`,
        routeKey: 'guilds/:guildId/bans/:userId',
        majorParam: opts.guildId,
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    kickMember: async (opts): Promise<Result<void, ModerationPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'DELETE',
        path: `/guilds/${opts.guildId}/members/${opts.userId}`,
        routeKey: 'guilds/:guildId/members/:userId',
        majorParam: opts.guildId,
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    timeoutMember: async (opts): Promise<Result<void, ModerationPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'PATCH',
        path: `/guilds/${opts.guildId}/members/${opts.userId}`,
        routeKey: 'guilds/:guildId/members/:userId',
        majorParam: opts.guildId,
        body: {
          // discord & fluxer wire schema requires explicit null to clear a timeout
          communication_disabled_until: opts.untilIso ?? null,
        },
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    bulkDeleteMessages: async (opts): Promise<Result<BulkDeleteResult, ModerationPortError>> => {
      const cutoffMs = nowMs() - FOURTEEN_DAYS_MS;
      const recentIds: string[] = [];
      const skippedOldIds: string[] = [];

      for (const id of opts.messageIds) {
        const ts = snowflakeTimestampMs(id);
        if (ts !== undefined && ts <= cutoffMs) {
          skippedOldIds.push(id);
        } else {
          recentIds.push(id);
        }
      }

      if (recentIds.length === 0) {
        return ok({deletedCount: 0, skippedOldIds});
      }

      if (recentIds.length === 1) {
        const singleId = recentIds[0];
        if (singleId !== undefined) {
          const singleRes = await restClient.request<undefined>({
            platform: opts.platform,
            method: 'DELETE',
            path: `/channels/${opts.channelId}/messages/${singleId}`,
            routeKey: 'channels/:channelId/messages/:messageId',
            majorParam: opts.channelId,
            auditLogReason: opts.reason,
          });
          if (!singleRes.ok) {
            return err(mapRestError(singleRes.error));
          }
          return ok({deletedCount: 1, skippedOldIds});
        }
      }

      let deletedCount = 0;
      for (let i = 0; i < recentIds.length; i += 100) {
        const chunk = recentIds.slice(i, i + 100);
        if (chunk.length === 1 && chunk[0] !== undefined) {
          const singleRes = await restClient.request<undefined>({
            platform: opts.platform,
            method: 'DELETE',
            path: `/channels/${opts.channelId}/messages/${chunk[0]}`,
            routeKey: 'channels/:channelId/messages/:messageId',
            majorParam: opts.channelId,
            auditLogReason: opts.reason,
          });
          if (!singleRes.ok) {
            return err(mapRestError(singleRes.error));
          }
          deletedCount += 1;
          continue;
        }
        const bulkRes = await restClient.request<undefined>({
          platform: opts.platform,
          method: 'POST',
          path: `/channels/${opts.channelId}/messages/bulk-delete`,
          routeKey: 'channels/:channelId/messages/bulk-delete',
          majorParam: opts.channelId,
          body: {messages: chunk},
          auditLogReason: opts.reason,
        });
        if (!bulkRes.ok) {
          return err(mapRestError(bulkRes.error));
        }
        deletedCount += chunk.length;
      }

      return ok({deletedCount, skippedOldIds});
    },
  };
}
