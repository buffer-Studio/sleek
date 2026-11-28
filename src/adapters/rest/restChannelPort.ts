import {err, ok, type Result} from '../../base/common/result';
import type {ChannelPort, ChannelPortError, ChannelSummary} from '../../core/ports/channel.port';
import type {RestClient} from './restClient';
import {mapRestError} from './restMessagingRolePorts';

export function createRestChannelPort(restClient: RestClient): ChannelPort {
  return {
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
}
