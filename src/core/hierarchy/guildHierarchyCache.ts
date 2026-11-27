import {z} from 'zod';

import {type Disposable, DisposableStore} from '../../base/common/disposable';
import type {PlatformId} from '../../base/common/platformId';
import {TieredCache} from '../../platform/cache/tieredCache';
import type {ValkeyClient} from '../../platform/cache/valkeyClient';
import type {EventBus} from '../events/eventBus';

const cachedGuildValkeySchema = z.object({
  name: z.string().optional(),
  vanityCode: z.string().optional(),
  ownerId: z.string().optional(),
  roles: z.array(z.tuple([z.string(), z.number()])),
});

const GUILD_VALKEY_PREFIX = 'sleek:hierarchy:guild';
const GUILD_VALKEY_TTL_SECONDS = 3600;

interface CachedMemberEntry {
  readonly found: boolean;
  readonly roles: readonly string[];
}

interface GuildMetadataState {
  name: string | undefined;
  vanityCode: string | undefined;
  ownerId: string | undefined;
  readonly rolePositions: Map<string, number>;
  botHighestRolePosition: number | undefined;
}

export interface HierarchyContext {
  readonly guildOwnerId: string | undefined;
  readonly actorHighestRolePosition: number | undefined;
  readonly targetHighestRolePosition: number | undefined;
  readonly botHighestRolePosition: number | undefined;
}

export interface FetchedGuildMetadata {
  readonly name?: string;
  readonly vanityCode?: string;
  readonly ownerId: string | undefined;
  readonly roles: ReadonlyArray<{readonly id: string; readonly position: number}>;
}

export interface FetchedMemberRoles {
  readonly found: boolean;
  readonly roles: readonly string[];
}

export interface GuildHierarchyCacheOptions {
  readonly eventBus: EventBus;
  readonly valkey?: ValkeyClient;
  readonly memberL1MaxEntries?: number;
  readonly memberL1TtlMs?: number;
  readonly fetchGuildMetadata?: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<FetchedGuildMetadata | undefined>;
  readonly fetchMemberRoles?: (
    platform: PlatformId,
    guildId: string,
    userId: string,
  ) => Promise<FetchedMemberRoles | undefined>;
}

export interface GuildHierarchyCache extends Disposable {
  readonly getGuildName: (platform: PlatformId, guildId: string) => string | undefined;
  readonly getGuildVanityCode: (platform: PlatformId, guildId: string) => string | undefined;
  readonly getGuildOwnerId: (platform: PlatformId, guildId: string) => string | undefined;
  readonly resolveGuildOwnerId: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<string | undefined>;
  readonly invalidateMemberRoles: (platform: PlatformId, guildId: string, userId: string) => void;
  readonly resolveHierarchyContext: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly actorId: string;
    readonly targetId?: string;
  }) => Promise<HierarchyContext>;
}

function guildKey(platform: PlatformId, guildId: string): string {
  return `${platform}:${guildId}`;
}

function memberKey(platform: PlatformId, guildId: string, userId: string): string {
  return `${platform}:${guildId}:${userId}`;
}

function computeHighestPosition(
  roleIds: readonly string[],
  rolePositions: ReadonlyMap<string, number>,
): number | undefined {
  let highest: number | undefined;
  for (const roleId of roleIds) {
    const pos = rolePositions.get(roleId);
    if (pos !== undefined && (highest === undefined || pos > highest)) {
      highest = pos;
    }
  }
  return highest;
}

export function createGuildHierarchyCache(
  options: GuildHierarchyCacheOptions,
): GuildHierarchyCache {
  const disposables = new DisposableStore();
  const botUserIds = new Map<PlatformId, string>();
  const unavailableGuilds = new Set<string>();
  const guilds = new Map<string, GuildMetadataState>();
  const memberCache = new TieredCache<string, CachedMemberEntry>({
    l1MaxEntries: options.memberL1MaxEntries ?? 50_000,
    l1TtlMs: options.memberL1TtlMs ?? 300_000,
  });

  function recomputeBotHighest(
    platform: PlatformId,
    guildId: string,
    state: GuildMetadataState,
  ): void {
    const botId = botUserIds.get(platform);
    if (botId === undefined) {
      return;
    }
    const cachedBot = memberCache.getOrLoad(memberKey(platform, guildId, botId), async () => {
      await Promise.resolve();
      return undefined;
    });
    void cachedBot.then(entry => {
      if (entry?.found === true) {
        state.botHighestRolePosition = computeHighestPosition(entry.roles, state.rolePositions);
      }
    });
  }

  function persistGuildToValkey(
    platform: PlatformId,
    guildId: string,
    state: GuildMetadataState,
  ): void {
    if (options.valkey === undefined) {
      return;
    }
    const payload = JSON.stringify({
      name: state.name,
      vanityCode: state.vanityCode,
      ownerId: state.ownerId,
      roles: [...state.rolePositions.entries()],
    });
    void options.valkey
      .set(`${GUILD_VALKEY_PREFIX}:${platform}:${guildId}`, payload, GUILD_VALKEY_TTL_SECONDS)
      .catch(() => undefined);
  }

  async function loadGuildMetadata(
    platform: PlatformId,
    guildId: string,
  ): Promise<GuildMetadataState | undefined> {
    const gKey = guildKey(platform, guildId);
    const existing = guilds.get(gKey);
    if (existing !== undefined) {
      return existing;
    }

    if (options.valkey !== undefined) {
      try {
        const raw = await options.valkey.get(`${GUILD_VALKEY_PREFIX}:${platform}:${guildId}`);
        if (raw !== undefined) {
          const parsed = cachedGuildValkeySchema.safeParse(JSON.parse(raw));
          if (parsed.success) {
            const rolePositions = new Map<string, number>();
            for (const [roleId, position] of parsed.data.roles) {
              rolePositions.set(roleId, position);
            }
            const state: GuildMetadataState = {
              name: parsed.data.name,
              vanityCode: parsed.data.vanityCode,
              ownerId: parsed.data.ownerId,
              rolePositions,
              botHighestRolePosition: undefined,
            };
            guilds.set(gKey, state);
            return state;
          }
        }
      } catch {
        // fall through to REST fallback
      }
    }

    // startup GUILD_CREATE burst guard: skip REST fetch while guild is still streaming after READY
    if (unavailableGuilds.has(gKey) || options.fetchGuildMetadata === undefined) {
      return undefined;
    }

    const fetched = await options.fetchGuildMetadata(platform, guildId);
    if (fetched === undefined) {
      return undefined;
    }

    const rolePositions = new Map<string, number>();
    for (const role of fetched.roles) {
      rolePositions.set(role.id, role.position);
    }
    const state: GuildMetadataState = {
      name: fetched.name,
      vanityCode: fetched.vanityCode,
      ownerId: fetched.ownerId,
      rolePositions,
      botHighestRolePosition: undefined,
    };
    guilds.set(gKey, state);
    persistGuildToValkey(platform, guildId, state);
    return state;
  }

  async function loadMemberRoles(
    platform: PlatformId,
    guildId: string,
    userId: string,
  ): Promise<CachedMemberEntry | undefined> {
    const mKey = memberKey(platform, guildId, userId);
    return memberCache.getOrLoad(mKey, async () => {
      if (options.fetchMemberRoles === undefined) {
        return undefined;
      }
      const fetched = await options.fetchMemberRoles(platform, guildId, userId);
      if (fetched === undefined) {
        return undefined;
      }
      return {found: fetched.found, roles: fetched.roles};
    });
  }

  disposables.add(
    options.eventBus.subscribeProjection('READY', event => {
      if (event.data.user?.id !== undefined) {
        botUserIds.set(event.platform, event.data.user.id);
      }
      for (const guild of event.data.guilds ?? []) {
        if (guild.id !== undefined && guild.unavailable === true) {
          unavailableGuilds.add(guildKey(event.platform, guild.id));
        }
      }
    }),
  );

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_CREATE', event => {
      const gKey = guildKey(event.platform, event.data.id);
      unavailableGuilds.delete(gKey);
      const rolePositions = new Map<string, number>();
      for (const role of event.data.roles) {
        rolePositions.set(role.id, role.position);
      }
      const state: GuildMetadataState = {
        name: event.data.name,
        vanityCode: event.data.vanity_url_code,
        ownerId: event.data.owner_id,
        rolePositions,
        botHighestRolePosition: undefined,
      };
      guilds.set(gKey, state);
      recomputeBotHighest(event.platform, event.data.id, state);
      persistGuildToValkey(event.platform, event.data.id, state);
    }),
  );

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_UPDATE', event => {
      const gKey = guildKey(event.platform, event.data.id);
      const state = guilds.get(gKey) ?? {
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
      guilds.set(gKey, state);
      recomputeBotHighest(event.platform, event.data.id, state);
      persistGuildToValkey(event.platform, event.data.id, state);
    }),
  );

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_DELETE', event => {
      const gKey = guildKey(event.platform, event.data.id);
      if (event.data.unavailable === true) {
        unavailableGuilds.add(gKey);
      } else {
        guilds.delete(gKey);
      }
    }),
  );

  const handleRoleUpsert = (
    platform: PlatformId,
    guildId: string,
    role: {readonly id: string; readonly position: number},
  ): void => {
    const gKey = guildKey(platform, guildId);
    const state = guilds.get(gKey);
    if (state === undefined) {
      return;
    }
    state.rolePositions.set(role.id, role.position);
    recomputeBotHighest(platform, guildId, state);
    persistGuildToValkey(platform, guildId, state);
  };

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_ROLE_CREATE', event => {
      handleRoleUpsert(event.platform, event.data.guild_id, event.data.role);
    }),
  );

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_ROLE_UPDATE', event => {
      handleRoleUpsert(event.platform, event.data.guild_id, event.data.role);
    }),
  );

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_ROLE_DELETE', event => {
      const state = guilds.get(guildKey(event.platform, event.data.guild_id));
      if (state === undefined) {
        return;
      }
      state.rolePositions.delete(event.data.role_id);
      recomputeBotHighest(event.platform, event.data.guild_id, state);
      persistGuildToValkey(event.platform, event.data.guild_id, state);
    }),
  );

  const handleMemberUpsert = (
    platform: PlatformId,
    guildId: string,
    userId: string,
    roles: readonly string[],
  ): void => {
    memberCache.set(memberKey(platform, guildId, userId), {found: true, roles});
    const botId = botUserIds.get(platform);
    if (botId !== undefined && userId === botId) {
      const state = guilds.get(guildKey(platform, guildId));
      if (state !== undefined) {
        state.botHighestRolePosition = computeHighestPosition(roles, state.rolePositions);
      }
    }
  };

  disposables.add(
    options.eventBus.subscribeProjection('GUILD_MEMBER_ADD', event => {
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
    options.eventBus.subscribeProjection('GUILD_MEMBER_UPDATE', event => {
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
    options.eventBus.subscribeProjection('GUILD_MEMBER_REMOVE', event => {
      memberCache.set(memberKey(event.platform, event.data.guild_id, event.data.user.id), {
        found: false,
        roles: [],
      });
    }),
  );

  // zero-intent opportunistic member role hydration on MESSAGE_CREATE and INTERACTION_CREATE
  disposables.add(
    options.eventBus.subscribeProjection('MESSAGE_CREATE', event => {
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
    options.eventBus.subscribeProjection('INTERACTION_CREATE', event => {
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

  return {
    getGuildName: (platform: PlatformId, guildId: string): string | undefined =>
      guilds.get(guildKey(platform, guildId))?.name,
    getGuildVanityCode: (platform: PlatformId, guildId: string): string | undefined =>
      guilds.get(guildKey(platform, guildId))?.vanityCode,
    getGuildOwnerId: (platform: PlatformId, guildId: string): string | undefined =>
      guilds.get(guildKey(platform, guildId))?.ownerId,
    resolveGuildOwnerId: async (
      platform: PlatformId,
      guildId: string,
    ): Promise<string | undefined> => {
      const cached = guilds.get(guildKey(platform, guildId));
      if (cached?.ownerId !== undefined) {
        return cached.ownerId;
      }
      const loaded = await loadGuildMetadata(platform, guildId);
      return loaded?.ownerId;
    },
    invalidateMemberRoles: (platform: PlatformId, guildId: string, userId: string): void => {
      memberCache.invalidate(memberKey(platform, guildId, userId));
    },
    resolveHierarchyContext: async (opts): Promise<HierarchyContext> => {
      const state = await loadGuildMetadata(opts.platform, opts.guildId);
      if (state === undefined) {
        return {
          guildOwnerId: undefined,
          actorHighestRolePosition: undefined,
          targetHighestRolePosition: undefined,
          botHighestRolePosition: undefined,
        };
      }

      const actorEntry = await loadMemberRoles(opts.platform, opts.guildId, opts.actorId);
      const actorHighestRolePosition =
        actorEntry?.found === true
          ? computeHighestPosition(actorEntry.roles, state.rolePositions)
          : undefined;

      let targetHighestRolePosition: number | undefined;
      if (opts.targetId !== undefined) {
        const targetEntry = await loadMemberRoles(opts.platform, opts.guildId, opts.targetId);
        targetHighestRolePosition =
          targetEntry?.found === true
            ? computeHighestPosition(targetEntry.roles, state.rolePositions)
            : undefined;
      }

      let botHighestRolePosition = state.botHighestRolePosition;
      const botId = botUserIds.get(opts.platform);
      if (botHighestRolePosition === undefined && botId !== undefined) {
        const botEntry = await loadMemberRoles(opts.platform, opts.guildId, botId);
        if (botEntry?.found === true) {
          botHighestRolePosition = computeHighestPosition(botEntry.roles, state.rolePositions);
          state.botHighestRolePosition = botHighestRolePosition;
        }
      }

      return {
        guildOwnerId: state.ownerId,
        actorHighestRolePosition,
        targetHighestRolePosition,
        botHighestRolePosition,
      };
    },
    dispose: (): void => {
      disposables.dispose();
    },
  };
}
