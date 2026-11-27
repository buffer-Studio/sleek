import {z} from 'zod';

import type {PlatformId} from '../../base/common/platformId';
import {AuthorityLevel, GlobalBotStaffTier} from '../../core/auth/authorityLevel';
import {
  canGrantNode,
  canModerateTarget,
  evaluatePermission,
  type PermissionDecision,
  resolveActorAuthorityLevel,
} from '../../core/auth/permissionKernel';
import {getBuiltinTemplate} from '../../core/auth/permissionTemplates';
import {normalizeGrantNodeInput} from '../../core/auth/sovereignNodes';
import type {CommandInvocationContext, CommandRegistry} from '../../core/commands/commandRegistry';
import {parseDurationMs} from '../../core/parser/durationParser';
import type {RolePort} from '../../core/ports/role.port';
import {buildVelocityKey, checkVelocityCounts} from '../../core/ratelimit/velocityMath';
import {TieredCache} from '../../platform/cache/tieredCache';
import type {ValkeyClient} from '../../platform/cache/valkeyClient';
import type {SleekConfigStore} from '../../platform/config/sleekConfig';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';
import type {
  ActingOwnerRecord,
  AuthorizeCommandInput,
  GuildSecuritySnapshot,
  SecurityService,
  SecurityStore,
} from './security.contract';

const INVALIDATION_CHANNEL = 'channel:config:invalidate';

const importPayloadSchema = z.object({
  version: z.literal(1),
  grants: z.array(
    z.object({
      targetId: z.string().regex(/^\d{17,20}$/),
      isRole: z.boolean(),
      node: z.string().min(1).max(128),
    }),
  ),
});

function mapBotStaffTier(tier: string | undefined): GlobalBotStaffTier {
  switch (tier) {
    case 'developer':
      return GlobalBotStaffTier.Developer;
    case 'admin':
      return GlobalBotStaffTier.Admin;
    case 'tns':
      return GlobalBotStaffTier.TrustAndSafety;
    case 'support':
      return GlobalBotStaffTier.Support;
    default:
      return GlobalBotStaffTier.None;
  }
}

function generateSessionId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function parseMentionOrId(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(?:<@[!&]?(\d{17,20})>|(\d{17,20}))$/.exec(raw.trim());
  return match?.[1] ?? match?.[2];
}

export interface CreateSecurityServiceOptions {
  readonly store: SecurityStore;
  readonly valkey: ValkeyClient;
  readonly configStore: SleekConfigStore;
  readonly botOwnersByPlatform: Readonly<Record<PlatformId, ReadonlySet<string>>>;
  readonly rolePort: RolePort;
  readonly logger: StructuredLogger;
}

export function createSecurityService(options: CreateSecurityServiceOptions): SecurityService {
  const {store, valkey, configStore, botOwnersByPlatform, rolePort, logger} = options;
  const cache = new TieredCache<string, GuildSecuritySnapshot>({
    l1MaxEntries: 10_000,
    l1TtlMs: 60_000,
  });
  const localVelocity = new Map<string, number[]>();

  async function loadSnapshot(
    platform: PlatformId,
    guildId: string,
  ): Promise<GuildSecuritySnapshot | undefined> {
    const cacheKey = `${platform}:${guildId}`;
    return cache.getOrLoad(cacheKey, async () => store.getGuildSecuritySnapshot(platform, guildId));
  }

  async function invalidateGuildCache(platform: PlatformId, guildId: string): Promise<void> {
    const key = `${platform}:${guildId}`;
    cache.invalidate(key);
    await valkey.publish(INVALIDATION_CHANNEL, key);
  }

  function isBotOwner(platform: PlatformId, userId: string): boolean {
    return botOwnersByPlatform[platform].has(userId);
  }

  async function resolveBotStaffTier(
    platform: PlatformId,
    userId: string,
  ): Promise<{readonly tier: GlobalBotStaffTier; readonly nodes: readonly string[]}> {
    if (isBotOwner(platform, userId)) {
      return {tier: GlobalBotStaffTier.Developer, nodes: ['bot.*']};
    }
    const staff = await store.getPlatformStaff(platform, userId);
    if (staff === undefined) {
      return {tier: GlobalBotStaffTier.None, nodes: []};
    }
    return {tier: mapBotStaffTier(staff.tier), nodes: staff.grantedNodes};
  }

  function activeActingOwnerId(
    ao: ActingOwnerRecord | undefined,
    nowMs: number,
  ): {
    readonly userId: string | undefined;
    readonly frozen: boolean;
  } {
    if (ao === undefined) {
      return {userId: undefined, frozen: false};
    }
    if (ao.leaseExpiresAtMs !== undefined && ao.leaseExpiresAtMs <= nowMs) {
      return {userId: undefined, frozen: false};
    }
    return {userId: ao.userId, frozen: ao.isFrozen};
  }

  async function resolveActorLevel(args: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly guildOwnerId: string | undefined;
    readonly roleIds: readonly string[];
  }): Promise<AuthorityLevel> {
    if (isBotOwner(args.platform, args.userId)) {
      return AuthorityLevel.PlatformDeveloper;
    }
    const snapshot = await loadSnapshot(args.platform, args.guildId);
    const nowMs = Date.now();
    const ao = activeActingOwnerId(snapshot?.actingOwner, nowMs);
    return resolveActorAuthorityLevel({
      actorId: args.userId,
      actorIsBotOwner: false,
      guildOwnerId: args.guildOwnerId,
      actingOwnerUserId: ao.userId,
      actingOwnerFrozen: ao.frozen,
      actorRoleIds: args.roleIds,
      boundAdminRoleIds: snapshot?.boundAdminRoleIds ?? new Set(),
      boundStaffRoleIds: snapshot?.boundStaffRoleIds ?? new Set(),
    });
  }

  async function authorize(input: AuthorizeCommandInput): Promise<PermissionDecision> {
    const botStaff = await resolveBotStaffTier(input.platform, input.actorId);
    const botOwner = isBotOwner(input.platform, input.actorId);
    const nowMs = Date.now();

    if (input.guildId === undefined) {
      return evaluatePermission({
        ...input,
        actorIsBotOwner: botOwner,
        actorBotStaffTier: botStaff.tier,
        actorBotStaffNodes: botStaff.nodes,
        boundAdminRoleIds: new Set(),
        boundStaffRoleIds: new Set(),
        grants: [],
        configEpoch: 1,
        storeAvailable: true,
        nowMs,
      });
    }

    const snapshot = await loadSnapshot(input.platform, input.guildId);
    if (snapshot === undefined) {
      return evaluatePermission({
        ...input,
        actorIsBotOwner: botOwner,
        actorBotStaffTier: botStaff.tier,
        actorBotStaffNodes: botStaff.nodes,
        boundAdminRoleIds: new Set(),
        boundStaffRoleIds: new Set(),
        grants: [],
        configEpoch: undefined,
        storeAvailable: false,
        nowMs,
      });
    }

    const ao = activeActingOwnerId(snapshot.actingOwner, nowMs);
    const aoGrants =
      ao.userId !== undefined && !ao.frozen
        ? (snapshot.actingOwner?.grantedNodes.map(node => ({
            targetId: ao.userId ?? '',
            isRole: false,
            node,
          })) ?? [])
        : [];

    return evaluatePermission({
      ...input,
      actorIsBotOwner: botOwner,
      actorBotStaffTier: botStaff.tier,
      actorBotStaffNodes: botStaff.nodes,
      actingOwnerUserId: ao.userId,
      actingOwnerFrozen: ao.frozen,
      boundAdminRoleIds: snapshot.boundAdminRoleIds,
      boundStaffRoleIds: snapshot.boundStaffRoleIds,
      grants: [...snapshot.grants, ...aoGrants],
      configEpoch: snapshot.epoch,
      storeAvailable: true,
      nowMs,
    });
  }

  async function recordStateChangeAndCheckVelocity(args: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly actorId: string;
    readonly actorLevel: AuthorityLevel;
    readonly actionType: string;
    readonly targetId?: string;
    readonly inverseAction?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  }): Promise<{readonly tripped: boolean; readonly reason: string | undefined}> {
    if (args.actorLevel === AuthorityLevel.PlatformDeveloper) {
      return {tripped: false, reason: undefined};
    }

    const policy = configStore.get();
    const snapshot = await loadSnapshot(args.platform, args.guildId);
    const nowMs = Date.now();
    const ao = snapshot?.actingOwner;

    let velocityConfig = {
      burstLimit: policy.security.velocityTripwires.level1.limit,
      burstWindowSeconds: policy.security.velocityTripwires.level1.windowSeconds,
      sustainedLimit: undefined as number | undefined,
      sustainedWindowSeconds: undefined as number | undefined,
    };

    if (args.actorLevel === AuthorityLevel.BoundAdmin) {
      velocityConfig = {
        burstLimit: policy.security.velocityTripwires.level2.limit,
        burstWindowSeconds: policy.security.velocityTripwires.level2.windowSeconds,
        sustainedLimit: undefined,
        sustainedWindowSeconds: undefined,
      };
    } else if (args.actorLevel === AuthorityLevel.ActingOwner && ao !== undefined) {
      velocityConfig = {
        burstLimit: ao.burstLimit,
        burstWindowSeconds: ao.burstWindowSeconds,
        sustainedLimit: ao.sustainedLimit,
        sustainedWindowSeconds: ao.sustainedWindowSeconds,
      };
    } else if (args.actorLevel === AuthorityLevel.TrueOwner) {
      velocityConfig = {
        burstLimit: policy.security.velocityTripwires.level4.limit,
        burstWindowSeconds: policy.security.velocityTripwires.level4.windowSeconds,
        sustainedLimit: undefined,
        sustainedWindowSeconds: undefined,
      };
    }

    const burstKey = buildVelocityKey(args.platform, args.guildId, args.actorId, 'burst');
    const burstWindowMs = velocityConfig.burstWindowSeconds * 1000;
    const burstArr = (localVelocity.get(burstKey) ?? []).filter(t => t > nowMs - burstWindowMs);
    burstArr.push(nowMs);
    localVelocity.set(burstKey, burstArr);

    let sustainedCount = 0;
    if (velocityConfig.sustainedWindowSeconds !== undefined) {
      const sustainedKey = buildVelocityKey(args.platform, args.guildId, args.actorId, 'sustained');
      const sustainedWindowMs = velocityConfig.sustainedWindowSeconds * 1000;
      const sustainedArr = (localVelocity.get(sustainedKey) ?? []).filter(
        t => t > nowMs - sustainedWindowMs,
      );
      sustainedArr.push(nowMs);
      localVelocity.set(sustainedKey, sustainedArr);
      sustainedCount = sustainedArr.length;
    }

    const isCompleteTrustActive =
      ao?.userId === args.actorId &&
      ao.isCompleteTrust &&
      (ao.trustExpiresAtMs === undefined || ao.trustExpiresAtMs > nowMs);

    const check = checkVelocityCounts({
      actorLevel: args.actorLevel,
      burstCount: burstArr.length,
      sustainedCount,
      config: velocityConfig,
      isCompleteTrustActive,
    });

    if (check.tripped) {
      if (args.actorLevel === AuthorityLevel.ActingOwner) {
        await store.setActingOwnerFrozen(args.platform, args.guildId, true);
        await invalidateGuildCache(args.platform, args.guildId);
      }
      logger.warn('security.velocity.tripped', {
        platform: args.platform,
        guildId: args.guildId,
        actorId: args.actorId,
        actorLevel: args.actorLevel,
        windowKind: check.windowKind,
        count: check.count,
        limit: check.limit,
      });
      return {
        tripped: true,
        reason: `Velocity tripwire tripped (${check.count}/${check.limit} in ${check.windowKind ?? 'burst'} window). Session frozen.`,
      };
    }

    if (args.actorLevel === AuthorityLevel.ActingOwner && ao !== undefined) {
      await store.appendLedgerEntry({
        id: generateSessionId(),
        platform: args.platform,
        guildId: args.guildId,
        sessionId: ao.sessionId,
        actionType: args.actionType,
        inverseAction: args.inverseAction,
        targetId: args.targetId,
        payload: args.payload ?? {},
        executedAtMs: nowMs,
        rolledBackAtMs: undefined,
      });
    }

    return {tripped: false, reason: undefined};
  }

  async function handleBind(ctx: CommandInvocationContext, tier: 'staff' | 'admin'): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Guild context required.');
      return;
    }
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    if (tokens.some(t => t.toLowerCase() === 'list')) {
      const roles = await store.listStaffRoles(ctx.platform, ctx.guildId, tier);
      await ctx.reply(
        roles.length === 0
          ? `No bound ${tier} roles configured.`
          : `Bound ${tier} roles: ${roles.map(r => `<@&${r}>`).join(', ')}`,
      );
      return;
    }

    const roleId = parseMentionOrId(tokens[0]);
    if (roleId === undefined) {
      await ctx.reply(`Usage: \`,bind ${tier} <@role|roleId|list>\``);
      return;
    }

    if (tier === 'admin') {
      const existingAdmins = await store.listStaffRoles(ctx.platform, ctx.guildId, 'admin');
      const maxAdmins = configStore.get().security.maxBoundAdminsPerGuild;
      if (!existingAdmins.includes(roleId) && existingAdmins.length >= maxAdmins) {
        await ctx.reply(`Maximum of ${maxAdmins} bound admin roles reached.`);
        return;
      }
    }

    const res = await store.toggleStaffRole({
      platform: ctx.platform,
      guildId: ctx.guildId,
      roleId,
      tier,
      actorId: ctx.actorId,
    });
    await invalidateGuildCache(ctx.platform, ctx.guildId);
    await ctx.reply(
      res.bound
        ? `Bound <@&${roleId}> as ${tier} role.`
        : `Unbound <@&${roleId}> from ${tier} roles.`,
    );
  }

  async function handleStrip(
    ctx: CommandInvocationContext,
    tier: 'staff' | 'admin',
  ): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Guild context required.');
      return;
    }
    const targetId = ctx.parsed.targets[0];
    if (targetId === undefined) {
      await ctx.reply(`Usage: \`,strip${tier} <@member> [reason]\``);
      return;
    }

    const actorLevel = await resolveActorLevel({
      platform: ctx.platform,
      guildId: ctx.guildId,
      userId: ctx.actorId,
      guildOwnerId: ctx.guildOwnerId,
      roleIds: ctx.actorRoleIds,
    });

    let targetRoleIds: readonly string[] = [];
    let hasExactTargetRoles = false;
    if (rolePort.getMemberRoles !== undefined) {
      const memberRolesRes = await rolePort.getMemberRoles({
        platform: ctx.platform,
        guildId: ctx.guildId,
        userId: targetId,
      });
      if (memberRolesRes.ok) {
        targetRoleIds = memberRolesRes.value;
        hasExactTargetRoles = true;
      }
    }

    const targetLevel = await resolveActorLevel({
      platform: ctx.platform,
      guildId: ctx.guildId,
      userId: targetId,
      guildOwnerId: ctx.guildOwnerId,
      roleIds: targetRoleIds,
    });

    const immunity = canModerateTarget({
      actorLevel,
      targetLevel,
      allowDeveloperOverrideTrueOwner: configStore.get().developer.allowOverrideTrueOwnerInBot,
    });
    if (!immunity.allowed) {
      await ctx.reply(immunity.reason);
      return;
    }

    const roleIds = await store.listStaffRoles(ctx.platform, ctx.guildId, tier);
    const rolesToStrip = hasExactTargetRoles
      ? roleIds.filter(roleId => targetRoleIds.includes(roleId))
      : roleIds;
    const reason = ctx.parsed.reason ?? `Emergency strip${tier} by ${ctx.actorId}`;

    if (rolesToStrip.length > 0) {
      const removeRes = await rolePort.removeMemberRoles({
        platform: ctx.platform,
        guildId: ctx.guildId,
        userId: targetId,
        roleIds: rolesToStrip,
        reason,
      });
      if (!removeRes.ok) {
        await ctx.reply(
          `Failed to strip ${tier} roles from <@${targetId}>: ${removeRes.error.message}`,
        );
        return;
      }
    }

    await ctx.reply(`Stripped ${rolesToStrip.length} bound ${tier} role(s) from <@${targetId}>.`);
  }

  async function handleFakePerms(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Guild context required.');
      return;
    }
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    const subRaw = tokens[0]?.toLowerCase() ?? 'list';
    const sub = subRaw === 'grant' ? 'add' : subRaw === 'revoke' ? 'remove' : subRaw;

    if (sub === 'list') {
      const filterTarget = parseMentionOrId(tokens[1]);
      const snapshot = await loadSnapshot(ctx.platform, ctx.guildId);
      const grants = (snapshot?.grants ?? []).filter(
        g => filterTarget === undefined || g.targetId === filterTarget,
      );
      if (grants.length === 0) {
        await ctx.reply('No fake permission grants found.');
        return;
      }
      const lines = grants.map(
        g => `${g.isRole ? `<@&${g.targetId}>` : `<@${g.targetId}>`}: \`${g.node}\``,
      );
      await ctx.reply(lines.slice(0, 25).join('\n'));
      return;
    }

    if (sub === 'explain') {
      const nodeArg = tokens[1];
      const targetArg = parseMentionOrId(tokens[2]) ?? ctx.actorId;
      if (nodeArg === undefined) {
        await ctx.reply('Usage: `,fp explain <node> [member]`');
        return;
      }
      const decision = await authorize({
        platform: ctx.platform,
        guildId: ctx.guildId,
        channelId: ctx.channelId,
        isDm: false,
        moduleEnabled: true,
        commandNode: nodeArg,
        actorId: targetArg,
        guildOwnerId: ctx.guildOwnerId,
        actorRoleIds: targetArg === ctx.actorId ? ctx.actorRoleIds : [],
      });
      const lines = decision.trace.map(t => `Stage ${t.stage} (${t.label}): ${t.detail}`);
      lines.push(`RESULT: ${decision.allowed ? 'ALLOW' : 'DENY'} — ${decision.reason}`);
      await ctx.reply(`\`\`\`\n${lines.join('\n')}\n\`\`\``);
      return;
    }

    if (sub === 'export') {
      const snapshot = await loadSnapshot(ctx.platform, ctx.guildId);
      const payload = {
        version: 1,
        grants: (snapshot?.grants ?? []).map(g => ({
          targetId: g.targetId,
          isRole: g.isRole,
          node: g.node,
        })),
      };
      const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
      await ctx.reply(`Exported permissions:\n\`${encoded}\``);
      return;
    }

    if (sub === 'import') {
      const encoded = tokens[1];
      if (encoded === undefined) {
        await ctx.reply('Usage: `,fp import <config_string>`');
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
      } catch {
        await ctx.reply('Invalid base64url import payload.');
        return;
      }
      const parsed = importPayloadSchema.safeParse(decoded);
      if (!parsed.success) {
        await ctx.reply('Import payload failed schema validation.');
        return;
      }
      const cap = configStore.get().security.freeBindingCapPerGuild;
      if (parsed.data.grants.length > cap) {
        await ctx.reply(`Import exceeds guild binding cap (${cap}).`);
        return;
      }
      const grouped = new Map<string, {isRole: boolean; nodes: string[]}>();
      for (const g of parsed.data.grants) {
        const norm = normalizeGrantNodeInput(g.node);
        const fullNode = norm.negated ? `-${norm.canonicalNode}` : norm.canonicalNode;
        const entry = grouped.get(g.targetId) ?? {isRole: g.isRole, nodes: []};
        entry.nodes.push(fullNode);
        grouped.set(g.targetId, entry);
      }
      for (const [targetId, entry] of grouped.entries()) {
        await store.addFakePermissions({
          platform: ctx.platform,
          guildId: ctx.guildId,
          targetId,
          isRole: entry.isRole,
          nodes: entry.nodes,
          expiresAtMs: undefined,
          channelScope: undefined,
          actorId: ctx.actorId,
        });
      }
      await invalidateGuildCache(ctx.platform, ctx.guildId);
      await ctx.reply(`Imported ${parsed.data.grants.length} permission binding(s).`);
      return;
    }

    if (sub === 'reset') {
      const targetId = parseMentionOrId(tokens[1]);
      await store.resetFakePermissions({
        platform: ctx.platform,
        guildId: ctx.guildId,
        targetId,
      });
      await invalidateGuildCache(ctx.platform, ctx.guildId);
      await ctx.reply(
        targetId === undefined
          ? 'Reset all guild fake permissions.'
          : `Reset fake permissions for target ${targetId}.`,
      );
      return;
    }

    if (sub === 'template') {
      const action = tokens[1]?.toLowerCase();
      const targetId = parseMentionOrId(tokens[2]);
      const templateName = tokens[3];
      if (action !== 'apply' || targetId === undefined || templateName === undefined) {
        await ctx.reply('Usage: `,fp template apply <@role> <trial-mod|moderator|admin|member>`');
        return;
      }
      const template = getBuiltinTemplate(templateName);
      if (template === undefined) {
        await ctx.reply(`Unknown template '${templateName}'.`);
        return;
      }
      await store.addFakePermissions({
        platform: ctx.platform,
        guildId: ctx.guildId,
        targetId,
        isRole: true,
        nodes: template.nodes,
        expiresAtMs: undefined,
        channelScope: undefined,
        actorId: ctx.actorId,
      });
      await invalidateGuildCache(ctx.platform, ctx.guildId);
      await ctx.reply(`Applied template \`${template.name}\` to <@&${targetId}>.`);
      return;
    }

    if (sub === 'add' || sub === 'remove') {
      const targetId = parseMentionOrId(tokens[1]);
      if (targetId === undefined) {
        await ctx.reply(`Usage: \`,fp ${sub} <@role|@user> <nodes...>\``);
        return;
      }
      const rawNodes = tokens.slice(2).filter(t => !t.startsWith('--'));
      if (rawNodes.length === 0) {
        await ctx.reply('Specify at least one permission node.');
        return;
      }

      if (sub === 'add') {
        const actorLevel = await resolveActorLevel({
          platform: ctx.platform,
          guildId: ctx.guildId,
          userId: ctx.actorId,
          guildOwnerId: ctx.guildOwnerId,
          roleIds: ctx.actorRoleIds,
        });
        const normalizedNodes: string[] = [];
        for (const rawNode of rawNodes) {
          const norm = normalizeGrantNodeInput(rawNode);
          const check = canGrantNode({
            actorLevel,
            targetLevel: AuthorityLevel.BoundStaff,
            isSelfGrant: targetId === ctx.actorId,
            node: norm.canonicalNode,
            actorHoldsNode: actorLevel >= AuthorityLevel.TrueOwner,
          });
          if (!check.allowed) {
            await ctx.reply(check.reason);
            return;
          }
          normalizedNodes.push(norm.negated ? `-${norm.canonicalNode}` : norm.canonicalNode);
        }

        const currentCount = await store.countGuildBindings(ctx.platform, ctx.guildId);
        const cap = configStore.get().security.freeBindingCapPerGuild;
        if (currentCount + normalizedNodes.length > cap) {
          await ctx.reply(`Guild binding cap reached (${currentCount}/${cap}).`);
          return;
        }

        const expiresAtMs =
          ctx.parsed.durationMs !== undefined ? Date.now() + ctx.parsed.durationMs : undefined;
        await store.addFakePermissions({
          platform: ctx.platform,
          guildId: ctx.guildId,
          targetId,
          isRole: true,
          nodes: normalizedNodes,
          expiresAtMs,
          channelScope: ctx.parsed.channelRef !== undefined ? [ctx.parsed.channelRef] : undefined,
          actorId: ctx.actorId,
        });
        await invalidateGuildCache(ctx.platform, ctx.guildId);
        await ctx.reply(`Granted ${normalizedNodes.length} node(s) to ${targetId}.`);
        return;
      }

      const normalizedRemove = rawNodes.map(n => {
        const norm = normalizeGrantNodeInput(n);
        return norm.negated ? `-${norm.canonicalNode}` : norm.canonicalNode;
      });
      const res = await store.removeFakePermissions({
        platform: ctx.platform,
        guildId: ctx.guildId,
        targetId,
        nodes: normalizedRemove,
      });
      await invalidateGuildCache(ctx.platform, ctx.guildId);
      await ctx.reply(`Removed ${res.removed} node(s) from ${targetId}.`);
      return;
    }

    await ctx.reply(
      'Unknown `,fp` subcommand. Use `add`, `remove`, `list`, `reset`, `explain`, `template`, `export`, or `import`.',
    );
  }

  async function handleActingOwner(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Guild context required.');
      return;
    }
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    const sub = tokens[0]?.toLowerCase() ?? 'view';
    const snapshot = await loadSnapshot(ctx.platform, ctx.guildId);

    if (sub === 'view') {
      const ao = snapshot?.actingOwner;
      if (ao === undefined) {
        await ctx.reply('No active Acting Owner in this guild.');
        return;
      }
      await ctx.reply(
        `Acting Owner: <@${ao.userId}> | Session: \`${ao.sessionId}\` | Frozen: ${String(ao.isFrozen)} | Burst: ${ao.burstLimit}/${ao.burstWindowSeconds}s | Sustained: ${ao.sustainedLimit}/${ao.sustainedWindowSeconds}s`,
      );
      return;
    }

    if (sub === 'revoke') {
      await store.revokeActingOwner(ctx.platform, ctx.guildId);
      await invalidateGuildCache(ctx.platform, ctx.guildId);
      await ctx.reply('Acting Owner lease revoked.');
      return;
    }

    if (sub === 'grant') {
      const targetId = parseMentionOrId(tokens[1]);
      if (targetId === undefined) {
        await ctx.reply(
          'Usage: `,actingowner grant <@user> [duration] [--complete-trust] [--rolling]`',
        );
        return;
      }
      const hasCompleteTrust = tokens.includes('--complete-trust');
      const hasRolling = tokens.includes('--rolling');
      const durationToken = tokens.slice(2).find(t => !t.startsWith('--'));
      const durationMs = durationToken !== undefined ? parseDurationMs(durationToken) : undefined;
      const maxTrustMs = configStore.get().security.maxActingOwnerTrustDays * 86_400_000;

      if (hasCompleteTrust && !hasRolling && durationMs === undefined) {
        await ctx.reply(
          '`--complete-trust` without `--rolling` requires an explicit duration (max 30d).',
        );
        return;
      }
      if (durationMs !== undefined && durationMs > maxTrustMs) {
        await ctx.reply(
          `Duration exceeds maximum of ${configStore.get().security.maxActingOwnerTrustDays}d.`,
        );
        return;
      }

      const policy = configStore.get().security.velocityTripwires.level3;
      const nowMs = Date.now();
      const sessionId = generateSessionId();

      await store.setActingOwner({
        platform: ctx.platform,
        guildId: ctx.guildId,
        userId: targetId,
        grantedNodes: ['*'],
        leaseExpiresAtMs: durationMs !== undefined ? nowMs + durationMs : undefined,
        sessionId,
        burstLimit: policy.burstLimit,
        burstWindowSeconds: policy.burstWindowSeconds,
        sustainedLimit: policy.sustainedLimit,
        sustainedWindowSeconds: policy.sustainedWindowSeconds,
        isCompleteTrust: hasCompleteTrust,
        isRolling: hasRolling,
        trustExpiresAtMs: hasCompleteTrust ? nowMs + (durationMs ?? maxTrustMs) : undefined,
        isFrozen: false,
        addedBy: ctx.actorId,
      });
      await invalidateGuildCache(ctx.platform, ctx.guildId);
      await ctx.reply(`Appointed <@${targetId}> as Acting Owner (Session \`${sessionId}\`).`);
      return;
    }

    if (sub === 'threshold') {
      const mode = tokens[1]?.toLowerCase();
      const policy = configStore.get().security;
      const ao = snapshot?.actingOwner;
      if (mode === 'view') {
        await ctx.reply(
          ao === undefined
            ? 'No Acting Owner active.'
            : `Burst: ${ao.burstLimit}/${ao.burstWindowSeconds}s | Sustained: ${ao.sustainedLimit}/${ao.sustainedWindowSeconds}s`,
        );
        return;
      }
      if (mode === 'reset') {
        await store.updateActingOwnerThresholds({
          platform: ctx.platform,
          guildId: ctx.guildId,
          burstLimit: policy.velocityTripwires.level3.burstLimit,
          burstWindowSeconds: policy.velocityTripwires.level3.burstWindowSeconds,
          sustainedLimit: policy.velocityTripwires.level3.sustainedLimit,
          sustainedWindowSeconds: policy.velocityTripwires.level3.sustainedWindowSeconds,
        });
        await invalidateGuildCache(ctx.platform, ctx.guildId);
        await ctx.reply('Acting Owner velocity thresholds reset to defaults.');
        return;
      }
      const pair = tokens[2]?.split('/');
      const limit = pair?.[0] !== undefined ? Number.parseInt(pair[0], 10) : Number.NaN;
      if (!Number.isSafeInteger(limit) || ao === undefined) {
        await ctx.reply('Usage: `,actingowner threshold <burst|sustained> <limit>/<window>`');
        return;
      }
      if (mode === 'burst') {
        if (
          limit < policy.actingOwnerHardBounds.burstMin ||
          limit > policy.actingOwnerHardBounds.burstMax
        ) {
          await ctx.reply(
            `Burst limit must be within [${policy.actingOwnerHardBounds.burstMin}, ${policy.actingOwnerHardBounds.burstMax}].`,
          );
          return;
        }
        await store.updateActingOwnerThresholds({
          platform: ctx.platform,
          guildId: ctx.guildId,
          burstLimit: limit,
          burstWindowSeconds: ao.burstWindowSeconds,
          sustainedLimit: ao.sustainedLimit,
          sustainedWindowSeconds: ao.sustainedWindowSeconds,
        });
        await invalidateGuildCache(ctx.platform, ctx.guildId);
        await ctx.reply(
          `Updated Acting Owner burst threshold to ${limit}/${ao.burstWindowSeconds}s.`,
        );
        return;
      }
      if (mode === 'sustained') {
        if (
          limit < policy.actingOwnerHardBounds.sustainedMin ||
          limit > policy.actingOwnerHardBounds.sustainedMax
        ) {
          await ctx.reply(
            `Sustained limit must be within [${policy.actingOwnerHardBounds.sustainedMin}, ${policy.actingOwnerHardBounds.sustainedMax}].`,
          );
          return;
        }
        await store.updateActingOwnerThresholds({
          platform: ctx.platform,
          guildId: ctx.guildId,
          burstLimit: ao.burstLimit,
          burstWindowSeconds: ao.burstWindowSeconds,
          sustainedLimit: limit,
          sustainedWindowSeconds: ao.sustainedWindowSeconds,
        });
        await invalidateGuildCache(ctx.platform, ctx.guildId);
        await ctx.reply(
          `Updated Acting Owner sustained threshold to ${limit}/${ao.sustainedWindowSeconds}s.`,
        );
        return;
      }
    }

    if (sub === 'rollback') {
      const sessionId = tokens[1];
      if (sessionId === undefined) {
        await ctx.reply('Usage: `,actingowner rollback <session_id>`');
        return;
      }
      const entries = await store.getSessionLedger(ctx.platform, ctx.guildId, sessionId);
      const pending = entries.filter(e => e.rolledBackAtMs === undefined);
      if (pending.length === 0) {
        await ctx.reply(`No un-reverted ledger entries found for session \`${sessionId}\`.`);
        return;
      }
      await store.markLedgerRolledBack(
        ctx.platform,
        ctx.guildId,
        pending.map(p => p.id),
        Date.now(),
      );
      await ctx.reply(
        `Marked ${pending.length} action(s) in session \`${sessionId}\` as rolled back.`,
      );
      return;
    }

    await ctx.reply('Unknown `,actingowner` subcommand.');
  }

  return {
    isBotOwner,
    resolveBotStaffTier,
    resolveActorLevel,
    authorize,
    assertEpochUnchanged: async (platform, guildId, expectedEpoch): Promise<boolean> => {
      const current = await store.getCurrentEpoch(platform, guildId);
      return current === expectedEpoch;
    },
    invalidateGuildCache,
    flushAllCaches: (): void => {
      cache.clear();
      localVelocity.clear();
    },
    recordStateChangeAndCheckVelocity,
    store,
    registerCommands: (registry: CommandRegistry): void => {
      registry.register({
        name: 'bind staff',
        aliases: ['bindstaff'],
        moduleId: 'security',
        permissionNode: 'security.staff.bind',
        description: 'Toggle a bound Staff role (L1)',
        mutatesState: true,
        execute: async ctx => handleBind(ctx, 'staff'),
      });
      registry.register({
        name: 'bind admin',
        aliases: ['bindadmin'],
        moduleId: 'security',
        permissionNode: 'security.admin.bind',
        description: 'Toggle a bound Admin role (L2)',
        mutatesState: true,
        execute: async ctx => handleBind(ctx, 'admin'),
      });
      registry.register({
        name: 'stripstaff',
        aliases: ['strip staff'],
        moduleId: 'security',
        permissionNode: 'security.staff.strip',
        description: 'Strip all bound staff roles from a member',
        mutatesState: true,
        adaptiveModeration: true,
        execute: async ctx => handleStrip(ctx, 'staff'),
      });
      registry.register({
        name: 'stripadmin',
        aliases: ['strip admin'],
        moduleId: 'security',
        permissionNode: 'security.admin.strip',
        description: 'Strip all bound admin roles from an admin',
        mutatesState: true,
        adaptiveModeration: true,
        execute: async ctx => handleStrip(ctx, 'admin'),
      });
      registry.register({
        name: 'fakepermissions',
        moduleId: 'security',
        permissionNode: 'security.fakeperms.manage',
        description: 'Manage virtual dot-notation fake permissions',
        mutatesState: true,
        acceptsDuration: true,
        execute: handleFakePerms,
      });
      registry.register({
        name: 'actingowner',
        moduleId: 'secokurity',
        permissionNode: 'security.actingowner.manage',
        description: 'Manage guild Acting Owner lease, thresholds, and rollback',
        mutatesState: true,
        execute: handleActingOwner,
      });
    },
  };
}
