import type {PlatformId} from '../../base/common/platformId';
import {err, ok, type Result} from '../../base/common/result';
import type {MessagingPort, MessagingPortError} from '../../core/ports/messaging.port';
import type {RolePort, RolePortError} from '../../core/ports/role.port';
import type {RestClient} from './restClient';
import type {RestError} from './restTypes';

export function mapRestError(error: RestError): {readonly code: string; readonly message: string} {
  return {
    code: error.code,
    message: error.message,
  };
}

export function createRestMessagingPort(restClient: RestClient): MessagingPort {
  return {
    sendMessage: async (opts): Promise<Result<string, MessagingPortError>> => {
      const res = await restClient.request<{readonly id?: string}>({
        platform: opts.platform,
        method: 'POST',
        path: `/channels/${opts.channelId}/messages`,
        routeKey: 'channels/:channelId/messages',
        majorParam: opts.channelId,
        body:
          opts.components !== undefined
            ? {content: opts.content, components: opts.components}
            : {content: opts.content},
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
        body:
          opts.components !== undefined
            ? {content: opts.content, components: opts.components}
            : {content: opts.content},
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
      const dmBody: Record<string, unknown> = {content: opts.content};
      if (opts.components !== undefined) {
        dmBody.components = opts.components;
      }
      if (opts.flags !== undefined) {
        dmBody.flags = opts.flags;
      }
      const msgRes = await restClient.request<{readonly id?: string}>({
        platform: opts.platform,
        method: 'POST',
        path: `/channels/${dmChannelRes.value.id}/messages`,
        routeKey: 'channels/:channelId/messages',
        majorParam: dmChannelRes.value.id,
        body: dmBody,
      });
      if (!msgRes.ok) {
        return err(mapRestError(msgRes.error));
      }
      return ok(msgRes.value.id ?? 'sent');
    },
  };
}

export function createRestRolePort(
  restClient: RestClient,
  onMemberRolesMutated?: (platform: PlatformId, guildId: string, userId: string) => void,
): RolePort {
  return {
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
      onMemberRolesMutated?.(opts.platform, opts.guildId, opts.userId);
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
      onMemberRolesMutated?.(opts.platform, opts.guildId, opts.userId);
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
}
