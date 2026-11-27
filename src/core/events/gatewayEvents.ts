import {z} from 'zod';

import type {PlatformId} from '../../base/common/platformId';

const roleSchema = z.object({
  id: z.string(),
  position: z.number().int(),
});

const readyGuildSchema = z.object({
  id: z.string().optional(),
  unavailable: z.boolean().optional(),
});

export const readyEventSchema = z.object({
  user: z
    .object({
      id: z.string(),
    })
    .optional(),
  guilds: z.array(readyGuildSchema).optional(),
});

const guildPropertiesSchema = z.object({
  name: z.string().nullish(),
  vanity_url_code: z.string().nullish(),
  owner_id: z.string().nullish(),
});

export const guildCreateEventSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    vanity_url_code: z.string().nullish(),
    owner_id: z.string().nullish(),
    properties: guildPropertiesSchema.optional(),
    roles: z.array(roleSchema).default([]),
  })
  .transform(data => ({
    id: data.id,
    name: data.name ?? data.properties?.name ?? undefined,
    vanity_url_code: data.vanity_url_code ?? data.properties?.vanity_url_code ?? undefined,
    owner_id: data.owner_id ?? data.properties?.owner_id ?? undefined,
    roles: data.roles,
  }));

export const guildUpdateEventSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    vanity_url_code: z.string().nullish(),
    owner_id: z.string().nullish(),
    properties: guildPropertiesSchema.optional(),
    roles: z.array(roleSchema).optional(),
  })
  .transform(data => ({
    id: data.id,
    name: data.name ?? data.properties?.name ?? undefined,
    vanity_url_code: data.vanity_url_code ?? data.properties?.vanity_url_code ?? undefined,
    owner_id: data.owner_id ?? data.properties?.owner_id ?? undefined,
    roles: data.roles,
  }));

export const guildDeleteEventSchema = z.object({
  id: z.string(),
  unavailable: z.boolean().optional(),
});

export const guildRoleUpsertEventSchema = z.object({
  guild_id: z.string(),
  role: roleSchema,
});

export const guildRoleDeleteEventSchema = z.object({
  guild_id: z.string(),
  role_id: z.string(),
});

export const guildMemberUpsertEventSchema = z.object({
  guild_id: z.string(),
  user: z
    .object({
      id: z.string(),
    })
    .optional(),
  roles: z.array(z.string()).default([]),
});

export const guildMemberRemoveEventSchema = z.object({
  guild_id: z.string(),
  user: z.object({
    id: z.string(),
  }),
});

export const messageCreateEventSchema = z.object({
  id: z.string().optional(),
  guild_id: z
    .string()
    .nullish()
    .transform(v => v ?? undefined),
  channel_id: z.string(),
  content: z.string().default(''),
  author: z.object({
    id: z.string(),
    bot: z
      .boolean()
      .nullish()
      .transform(v => v ?? undefined),
  }),
  member: z
    .object({
      roles: z.array(z.string()).default([]),
    })
    .nullish()
    .transform(v => v ?? undefined),
});

export const messageUpdateEventSchema = z.object({
  id: z.string(),
  guild_id: z.string().optional(),
  channel_id: z.string(),
  content: z.string().optional(),
  author: z
    .object({
      id: z.string(),
      bot: z.boolean().optional(),
    })
    .optional(),
});

export const messageDeleteEventSchema = z.object({
  id: z.string(),
  guild_id: z.string().optional(),
  channel_id: z.string(),
});

export const messageDeleteBulkEventSchema = z.object({
  ids: z.array(z.string()),
  guild_id: z.string().optional(),
  channel_id: z.string(),
});

export const interactionCreateEventSchema = z.object({
  id: z.string(),
  token: z.string(),
  type: z.number().int(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  member: z
    .object({
      user: z
        .object({
          id: z.string(),
        })
        .optional(),
      roles: z.array(z.string()).default([]),
    })
    .optional(),
  user: z
    .object({
      id: z.string(),
    })
    .optional(),
  data: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      custom_id: z.string().optional(),
      options: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export const gatewayCloseEventSchema = z.object({
  code: z.number().int().default(1000),
  reason: z.string().default(''),
});

export const channelUpdateEventSchema = z.object({
  id: z.string(),
  guild_id: z
    .string()
    .nullish()
    .transform(v => v ?? undefined),
  topic: z.string().nullable().optional(),
});

export type ReadyEventData = z.infer<typeof readyEventSchema>;
export type GuildCreateEventData = z.infer<typeof guildCreateEventSchema>;
export type GuildUpdateEventData = z.infer<typeof guildUpdateEventSchema>;
export type GuildDeleteEventData = z.infer<typeof guildDeleteEventSchema>;
export type GuildRoleUpsertEventData = z.infer<typeof guildRoleUpsertEventSchema>;
export type GuildRoleDeleteEventData = z.infer<typeof guildRoleDeleteEventSchema>;
export type GuildMemberUpsertEventData = z.infer<typeof guildMemberUpsertEventSchema>;
export type GuildMemberRemoveEventData = z.infer<typeof guildMemberRemoveEventSchema>;
export type MessageCreateEventData = z.infer<typeof messageCreateEventSchema>;
export type MessageUpdateEventData = z.infer<typeof messageUpdateEventSchema>;
export type MessageDeleteEventData = z.infer<typeof messageDeleteEventSchema>;
export type MessageDeleteBulkEventData = z.infer<typeof messageDeleteBulkEventSchema>;
export type InteractionCreateEventData = z.infer<typeof interactionCreateEventSchema>;
export type GatewayCloseEventData = z.infer<typeof gatewayCloseEventSchema>;
export type ChannelUpdateEventData = z.infer<typeof channelUpdateEventSchema>;

export type GatewayDomainEvent =
  | {
      readonly type: 'READY';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: ReadyEventData;
    }
  | {
      readonly type: 'GUILD_CREATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildCreateEventData;
    }
  | {
      readonly type: 'GUILD_UPDATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildUpdateEventData;
    }
  | {
      readonly type: 'GUILD_DELETE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildDeleteEventData;
    }
  | {
      readonly type: 'GUILD_ROLE_CREATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildRoleUpsertEventData;
    }
  | {
      readonly type: 'GUILD_ROLE_UPDATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildRoleUpsertEventData;
    }
  | {
      readonly type: 'GUILD_ROLE_DELETE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildRoleDeleteEventData;
    }
  | {
      readonly type: 'GUILD_MEMBER_ADD';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildMemberUpsertEventData;
    }
  | {
      readonly type: 'GUILD_MEMBER_UPDATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildMemberUpsertEventData;
    }
  | {
      readonly type: 'GUILD_MEMBER_REMOVE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GuildMemberRemoveEventData;
    }
  | {
      readonly type: 'MESSAGE_CREATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: MessageCreateEventData;
    }
  | {
      readonly type: 'MESSAGE_UPDATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: MessageUpdateEventData;
    }
  | {
      readonly type: 'MESSAGE_DELETE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: MessageDeleteEventData;
    }
  | {
      readonly type: 'MESSAGE_DELETE_BULK';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: MessageDeleteBulkEventData;
    }
  | {
      readonly type: 'INTERACTION_CREATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: InteractionCreateEventData;
    }
  | {
      readonly type: 'GATEWAY_CLOSED';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GatewayCloseEventData;
    }
  | {
      readonly type: 'GATEWAY_FATAL_CLOSE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: GatewayCloseEventData;
    }
  | {
      readonly type: 'CHANNEL_UPDATE';
      readonly platform: PlatformId;
      readonly shardId: number;
      readonly data: ChannelUpdateEventData;
    };

export type GatewayEventType = GatewayDomainEvent['type'];

const EVENT_SCHEMA_MAP: Readonly<Record<GatewayEventType, z.ZodType>> = {
  READY: readyEventSchema,
  GUILD_CREATE: guildCreateEventSchema,
  GUILD_UPDATE: guildUpdateEventSchema,
  GUILD_DELETE: guildDeleteEventSchema,
  GUILD_ROLE_CREATE: guildRoleUpsertEventSchema,
  GUILD_ROLE_UPDATE: guildRoleUpsertEventSchema,
  GUILD_ROLE_DELETE: guildRoleDeleteEventSchema,
  GUILD_MEMBER_ADD: guildMemberUpsertEventSchema,
  GUILD_MEMBER_UPDATE: guildMemberUpsertEventSchema,
  GUILD_MEMBER_REMOVE: guildMemberRemoveEventSchema,
  MESSAGE_CREATE: messageCreateEventSchema,
  MESSAGE_UPDATE: messageUpdateEventSchema,
  MESSAGE_DELETE: messageDeleteEventSchema,
  MESSAGE_DELETE_BULK: messageDeleteBulkEventSchema,
  INTERACTION_CREATE: interactionCreateEventSchema,
  GATEWAY_CLOSED: gatewayCloseEventSchema,
  GATEWAY_FATAL_CLOSE: gatewayCloseEventSchema,
  CHANNEL_UPDATE: channelUpdateEventSchema,
};

export function isKnownGatewayEventType(eventType: string): eventType is GatewayEventType {
  return Object.hasOwn(EVENT_SCHEMA_MAP, eventType);
}

export function parseGatewayDomainEvent(
  eventType: string,
  platform: PlatformId,
  shardId: number,
  rawJson: string,
): GatewayDomainEvent | undefined {
  if (!isKnownGatewayEventType(eventType)) {
    return undefined;
  }
  let rawObj: unknown;
  try {
    rawObj = JSON.parse(rawJson) as unknown;
  } catch {
    return undefined;
  }
  const schema = EVENT_SCHEMA_MAP[eventType];
  const parsed = schema.safeParse(rawObj);
  if (!parsed.success) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    type: eventType,
    platform,
    shardId,
    data: parsed.data,
  } as GatewayDomainEvent;
}
