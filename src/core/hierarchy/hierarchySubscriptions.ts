import type {DisposableStore} from '../../base/common/disposable';
import type {PlatformId} from '../../base/common/platformId';
import type {EventBus} from '../events/eventBus';
import type {TieredCache} from '../../platform/cache/tieredCache';

export interface HierarchySubscriptionState {
  readonly botUserIds: Map<PlatformId, string>;
  readonly unavailableGuilds: Set<string>;
  readonly guilds: Map<
    string,
    {
      name: string | undefined;
      vanityCode: string | undefined;
      ownerId: string | undefined;
      rolePositions: Map<string, number>;
      botHighestRolePosition: number | undefined;
    }
  >;
  readonly memberCache: TieredCache<
    string,
    {readonly found: boolean; readonly roles: readonly string[]}
  >;
  readonly guildKey: (platform: PlatformId, guildId: string) => string;
  readonly memberKey: (platform: PlatformId, guildId: string, userId: string) => string;
  readonly computeHighestPosition: (
    roleIds: readonly string[],
    rolePositions: ReadonlyMap<string, number>,
  ) => number | undefined;
  readonly recomputeBotHighest: (
    platform: PlatformId,
    guildId: string,
    state: {
      name: string | undefined;
      vanityCode: string | undefined;
      ownerId: string | undefined;
      rolePositions: Map<string, number>;
      botHighestRolePosition: number | undefined;
    },
  ) => void;
  readonly persistGuildToValkey: (
    platform: PlatformId,
    guildId: string,
    state: {
      name: string | undefined;
      vanityCode: string | undefined;
      ownerId: string | undefined;
      rolePositions: Map<string, number>;
      botHighestRolePosition: number | undefined;
    },
  ) => void;
}

export function subscribeHierarchyEvents(
  eventBus: EventBus,
  disposables: DisposableStore,
  ctx: HierarchySubscriptionState,
): void {
  disposables.add(
    eventBus.subscribeProjection('READY', event => {
      if (event.data.user?.id !== undefined) {
        ctx.botUserIds.set(event.platform, event.data.user.id);
      }
      for (const guild of event.data.guilds ?? []) {
        if (guild.id !== undefined && guild.unavailable === true) {
          ctx.unavailableGuilds.add(ctx.guildKey(event.platform, guild.id));
        }
      }
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_CREATE', event => {
      const gKey = ctx.guildKey(event.platform, event.data.id);
      ctx.unavailableGuilds.delete(gKey);
      const rolePositions = new Map<string, number>();
      for (const role of event.data.roles) {
        rolePositions.set(role.id, role.position);
      }
      const state = {
        name: event.data.name,
        vanityCode: event.data.vanity_url_code,
        ownerId: event.data.owner_id,
        rolePositions,
        botHighestRolePosition: undefined,
      };
      ctx.guilds.set(gKey, state);
      ctx.recomputeBotHighest(event.platform, event.data.id, state);
      ctx.persistGuildToValkey(event.platform, event.data.id, state);
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_UPDATE', event => {
      const gKey = ctx.guildKey(event.platform, event.data.id);
      const state = ctx.guilds.get(gKey) ?? {
        name: event.data.name,
        vanityCode: event.data.vanity_url_code,
        ownerId: event.data.owner_id,
        rolePositions: new Map<string, number>(),
        botHighestRolePosition: undefined,
      };
      if (event.data.name !== undefined) {
        state.name = event.data.name;
      }
      if (event.data.vanity_url_code !== undefined) {
        state.vanityCode = event.data.vanity_url_code;
      }
      if (event.data.owner_id !== undefined) {
        state.ownerId = event.data.owner_id;
      }
      if (event.data.roles !== undefined) {
        state.rolePositions.clear();
        for (const role of event.data.roles) {
          state.rolePositions.set(role.id, role.position);
        }
      }
      ctx.guilds.set(gKey, state);
      ctx.recomputeBotHighest(event.platform, event.data.id, state);
      ctx.persistGuildToValkey(event.platform, event.data.id, state);
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_DELETE', event => {
      const gKey = ctx.guildKey(event.platform, event.data.id);
      if (event.data.unavailable === true) {
        ctx.unavailableGuilds.add(gKey);
      } else {
        ctx.guilds.delete(gKey);
      }
    }),
  );

  const handleRoleUpsert = (
    platform: PlatformId,
    guildId: string,
    role: {readonly id: string; readonly position: number},
  ): void => {
    const gKey = ctx.guildKey(platform, guildId);
    const state = ctx.guilds.get(gKey);
    if (state === undefined) {
      return;
    }
    state.rolePositions.set(role.id, role.position);
    ctx.recomputeBotHighest(platform, guildId, state);
    ctx.persistGuildToValkey(platform, guildId, state);
  };

  disposables.add(
    eventBus.subscribeProjection('GUILD_ROLE_CREATE', event => {
      handleRoleUpsert(event.platform, event.data.guild_id, event.data.role);
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_ROLE_UPDATE', event => {
      handleRoleUpsert(event.platform, event.data.guild_id, event.data.role);
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_ROLE_DELETE', event => {
      const state = ctx.guilds.get(ctx.guildKey(event.platform, event.data.guild_id));
      if (state === undefined) {
        return;
      }
      state.rolePositions.delete(event.data.role_id);
      ctx.recomputeBotHighest(event.platform, event.data.guild_id, state);
      ctx.persistGuildToValkey(event.platform, event.data.guild_id, state);
    }),
  );

  const handleMemberUpsert = (
    platform: PlatformId,
    guildId: string,
    userId: string,
    roles: readonly string[],
  ): void => {
    ctx.memberCache.set(ctx.memberKey(platform, guildId, userId), {found: true, roles});
    const botId = ctx.botUserIds.get(platform);
    if (botId !== undefined && userId === botId) {
      const state = ctx.guilds.get(ctx.guildKey(platform, guildId));
      if (state !== undefined) {
        state.botHighestRolePosition = ctx.computeHighestPosition(roles, state.rolePositions);
      }
    }
  };

  disposables.add(
    eventBus.subscribeProjection('GUILD_MEMBER_ADD', event => {
      if (event.data.user?.id !== undefined) {
        handleMemberUpsert(
          event.platform,
          event.data.guild_id,
          event.data.user.id,
          event.data.roles,
        );
      }
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_MEMBER_UPDATE', event => {
      if (event.data.user?.id !== undefined) {
        handleMemberUpsert(
          event.platform,
          event.data.guild_id,
          event.data.user.id,
          event.data.roles,
        );
      }
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('GUILD_MEMBER_REMOVE', event => {
      ctx.memberCache.set(ctx.memberKey(event.platform, event.data.guild_id, event.data.user.id), {
        found: false,
        roles: [],
      });
    }),
  );

  // zero-intent opportunistic member role hydration on MESSAGE_CREATE and INTERACTION_CREATE
  disposables.add(
    eventBus.subscribeProjection('MESSAGE_CREATE', event => {
      if (event.data.guild_id !== undefined && event.data.member !== undefined) {
        handleMemberUpsert(
          event.platform,
          event.data.guild_id,
          event.data.author.id,
          event.data.member.roles,
        );
      }
    }),
  );

  disposables.add(
    eventBus.subscribeProjection('INTERACTION_CREATE', event => {
      const userId = event.data.member?.user?.id ?? event.data.user?.id;
      if (
        event.data.guild_id !== undefined &&
        event.data.member !== undefined &&
        userId !== undefined
      ) {
        handleMemberUpsert(event.platform, event.data.guild_id, userId, event.data.member.roles);
      }
    }),
  );
}
