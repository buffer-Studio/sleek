import type {PlatformId} from '../../base/common/platformId';
import {err, ok, type Result} from '../../base/common/result';
import type {ChannelPort, ChannelPortError, ChannelSummary} from '../../core/ports/channel.port';
import type {InteractionPort, InteractionPortError} from '../../core/ports/interaction.port';
import type {MessagingPort, MessagingPortError} from '../../core/ports/messaging.port';
import type {
  BulkDeleteResult,
  ModerationPort,
  ModerationPortError,
} from '../../core/ports/moderation.port';
import type {RolePort, RolePortError} from '../../core/ports/role.port';
import type {RestClient} from './restClient';
import type {RestError} from './restTypes';

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const FOURTEEN_DAYS_MS = 14 * 86_400_000;
const EPHEMERAL_FLAG = 1 << 6;
const INTERACTION_ACK_TIMEOUT_MS = 2500;
const INTERACTION_FOLLOWUP_TIMEOUT_MS = 10_000;

export interface CreateRestPortsOptions {
  readonly restClient: RestClient;
  readonly nowMs?: () => number;
  readonly onMemberRolesMutated?: (platform: PlatformId, guildId: string, userId: string) => void;
}

export interface RestPortsBundle {
  readonly messagingPort: MessagingPort;
  readonly rolePort: RolePort;
  readonly moderationPort: ModerationPort;
  readonly channelPort: ChannelPort;
  readonly interactionPort: InteractionPort;
}

function mapRestError(error: RestError): {readonly code: string; readonly message: string} {
  return {
    code: error.code,
    message: error.message,
  };
}

function snowflakeTimestampMs(id: string): number | undefined {
  try {
    const raw = BigInt(id);
    return Number((raw >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return undefined;
  }
}

export function createRestPorts(options: CreateRestPortsOptions): RestPortsBundle {
  const {restClient} = options;
  const nowMs = options.nowMs ?? (() => Date.now());

  const messagingPort: MessagingPort = {
    sendMessage: async (opts): Promise<Result<string, MessagingPortError>> => {
      const res = await restClient.request<{readonly id?: string}>({
        platform: opts.platform,
        method: 'POST',
        path: `/channels/${opts.channelId}/messages`,
        routeKey: 'channels/:channelId/messages',
        majorParam: opts.channelId,
        body: {content: opts.content},
      });
      if (!res.ok) {
        return err(mapRestError(res.error));
      }
      return ok(res.value.id ?? 'sent');
    },
    editMessage: async (opts): Promise<Result<void, MessagingPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'PATCH',
        path: `/channels/${opts.channelId}/messages/${opts.messageId}`,
        routeKey: 'channels/:channelId/messages/:messageId',
        majorParam: opts.channelId,
        body: {content: opts.content},
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    deleteMessage: async (opts): Promise<Result<void, MessagingPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'DELETE',
        path: `/channels/${opts.channelId}/messages/${opts.messageId}`,
        routeKey: 'channels/:channelId/messages/:messageId',
        majorParam: opts.channelId,
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    sendDirectMessage: async (opts): Promise<Result<string, MessagingPortError>> => {
      const dmChannelRes = await restClient.request<{readonly id: string}>({
        platform: opts.platform,
        method: 'POST',
        path: '/users/@me/channels',
        routeKey: 'users/@me/channels',
        body: {recipient_id: opts.userId},
      });
      if (!dmChannelRes.ok) {
        return err(mapRestError(dmChannelRes.error));
      }
      const msgRes = await restClient.request<{readonly id?: string}>({
        platform: opts.platform,
        method: 'POST',
        path: `/channels/${dmChannelRes.value.id}/messages`,
        routeKey: 'channels/:channelId/messages',
        majorParam: dmChannelRes.value.id,
        body: {content: opts.content},
      });
      if (!msgRes.ok) {
        return err(mapRestError(msgRes.error));
      }
      return ok(msgRes.value.id ?? 'sent');
    },
  };

  const rolePort: RolePort = {
    removeMemberRoles: async (opts): Promise<Result<void, RolePortError>> => {
      for (const roleId of opts.roleIds) {
        const res = await restClient.request<undefined>({
          platform: opts.platform,
          method: 'DELETE',
          path: `/guilds/${opts.guildId}/members/${opts.userId}/roles/${roleId}`,
          routeKey: 'guilds/:guildId/members/:userId/roles/:roleId',
          majorParam: opts.guildId,
          auditLogReason: opts.reason,
        });
        if (!res.ok) {
          return err(mapRestError(res.error));
        }
      }
      options.onMemberRolesMutated?.(opts.platform, opts.guildId, opts.userId);
      return ok(undefined);
    },
    addMemberRoles: async (opts): Promise<Result<void, RolePortError>> => {
      for (const roleId of opts.roleIds) {
        const res = await restClient.request<undefined>({
          platform: opts.platform,
          method: 'PUT',
          path: `/guilds/${opts.guildId}/members/${opts.userId}/roles/${roleId}`,
          routeKey: 'guilds/:guildId/members/:userId/roles/:roleId',
          majorParam: opts.guildId,
          auditLogReason: opts.reason,
        });
        if (!res.ok) {
          return err(mapRestError(res.error));
        }
      }
      options.onMemberRolesMutated?.(opts.platform, opts.guildId, opts.userId);
      return ok(undefined);
    },
    getMemberRoles: async (opts): Promise<Result<readonly string[], RolePortError>> => {
      const res = await restClient.request<{readonly roles?: readonly string[]}>({
        platform: opts.platform,
        method: 'GET',
        path: `/guilds/${opts.guildId}/members/${opts.userId}`,
        routeKey: 'guilds/:guildId/members/:userId',
        majorParam: opts.guildId,
      });
      if (!res.ok) {
        return err(mapRestError(res.error));
      }
      return ok(res.value.roles ?? []);
    },
  };

  const moderationPort: ModerationPort = {
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

  const channelPort: ChannelPort = {
    setChannelOverwrite: async (opts): Promise<Result<void, ChannelPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'PUT',
        path: `/channels/${opts.channelId}/permissions/${opts.overwriteId}`,
        routeKey: 'channels/:channelId/permissions/:overwriteId',
        majorParam: opts.channelId,
        body: {
          type: opts.targetType === 'role' ? 0 : 1,
          allow: opts.allowBits,
          deny: opts.denyBits,
        },
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    deleteChannelOverwrite: async (opts): Promise<Result<void, ChannelPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'DELETE',
        path: `/channels/${opts.channelId}/permissions/${opts.overwriteId}`,
        routeKey: 'channels/:channelId/permissions/:overwriteId',
        majorParam: opts.channelId,
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    updateChannelTopic: async (opts): Promise<Result<void, ChannelPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'PATCH',
        path: `/channels/${opts.channelId}`,
        routeKey: 'channels/:channelId',
        majorParam: opts.channelId,
        auditLogReason: opts.reason,
        body: {topic: opts.topic},
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    fetchChannel: async (opts): Promise<Result<ChannelSummary, ChannelPortError>> => {
      const res = await restClient.request<{
        readonly id: string;
        readonly guild_id?: string | null;
        readonly type: number;
        readonly name?: string | null;
        readonly topic?: string | null;
      }>({
        platform: opts.platform,
        method: 'GET',
        path: `/channels/${opts.channelId}`,
        routeKey: 'channels/:channelId',
        majorParam: opts.channelId,
      });
      if (!res.ok) {
        return err(mapRestError(res.error));
      }
      return ok({
        id: res.value.id,
        guildId: res.value.guild_id ?? undefined,
        type: res.value.type,
        name: res.value.name ?? undefined,
        topic: res.value.topic ?? undefined,
      });
    },
    listGuildChannels: async (
      opts,
    ): Promise<Result<readonly ChannelSummary[], ChannelPortError>> => {
      const res = await restClient.request<
        ReadonlyArray<{
          readonly id: string;
          readonly guild_id?: string | null;
          readonly type: number;
          readonly name?: string | null;
          readonly topic?: string | null;
        }>
      >({
        platform: opts.platform,
        method: 'GET',
        path: `/guilds/${opts.guildId}/channels`,
        routeKey: 'guilds/:guildId/channels',
        majorParam: opts.guildId,
      });
      if (!res.ok) {
        return err(mapRestError(res.error));
      }
      return ok(
        res.value.map(ch => ({
          id: ch.id,
          guildId: ch.guild_id ?? undefined,
          type: ch.type,
          name: ch.name ?? undefined,
          topic: ch.topic ?? undefined,
        })),
      );
    },
    createChannel: async (opts): Promise<Result<ChannelSummary, ChannelPortError>> => {
      const res = await restClient.request<{
        readonly id: string;
        readonly guild_id?: string | null;
        readonly type: number;
        readonly name?: string | null;
        readonly topic?: string | null;
      }>({
        platform: opts.platform,
        method: 'POST',
        path: `/guilds/${opts.guildId}/channels`,
        routeKey: 'guilds/:guildId/channels',
        majorParam: opts.guildId,
        auditLogReason: opts.reason,
        body: {
          name: opts.name,
          type: opts.type ?? 0,
          ...(opts.position !== undefined ? {position: opts.position} : {}),
          ...(opts.parentId !== undefined ? {parent_id: opts.parentId} : {}),
          ...(opts.topic !== undefined ? {topic: opts.topic} : {}),
          ...(opts.permissionOverwrites !== undefined
            ? {
                permission_overwrites: opts.permissionOverwrites.map(o => ({
                  id: o.id,
                  type: o.type === 'role' ? 0 : 1,
                  allow: o.allow,
                  deny: o.deny,
                })),
              }
            : {}),
        },
      });
      if (!res.ok) {
        return err(mapRestError(res.error));
      }
      return ok({
        id: res.value.id,
        guildId: res.value.guild_id ?? opts.guildId,
        type: res.value.type,
        name: res.value.name ?? undefined,
        topic: res.value.topic ?? undefined,
      });
    },
    deleteChannel: async (opts): Promise<Result<void, ChannelPortError>> => {
      const res = await restClient.request<undefined>({
        platform: opts.platform,
        method: 'DELETE',
        path: `/channels/${opts.channelId}`,
        routeKey: 'channels/:channelId',
        majorParam: opts.channelId,
        auditLogReason: opts.reason,
      });
      return res.ok ? ok(undefined) : err(mapRestError(res.error));
    },
    createInvite: async (opts): Promise<Result<string, ChannelPortError>> => {
      const res = await restClient.request<{readonly code?: string}>({
        platform: opts.platform,
        method: 'POST',
        path: `/channels/${opts.channelId}/invites`,
        routeKey: 'channels/:channelId/invites',
        majorParam: opts.channelId,
        auditLogReason: opts.reason,
        body: {
          max_age: opts.maxAgeSeconds ?? 86_400,
          max_uses: opts.maxUses ?? 1,
          unique: opts.unique ?? true,
        },
      });
      if (!res.ok) {
        return err(mapRestError(res.error));
      }
      if (res.value.code === undefined || res.value.code.length === 0) {
        return err({code: 'invalid_response', message: 'Invite response missing code'});
      }
      return ok(res.value.code);
    },
  };

  const interactionPort: InteractionPort = {
    replyInteraction: async (opts): Promise<Result<void, InteractionPortError>> => {
      if (opts.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
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
      if (opts.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
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
      if (opts.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
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
      if (opts.platform === 'fluxer') {
        return err({
          code: 'unsupported_platform',
          message: 'Fluxer does not support INTERACTION_CREATE',
        });
      }
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

  return {
    messagingPort,
    rolePort,
    moderationPort,
    channelPort,
    interactionPort,
  };
}
