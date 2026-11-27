import type {PlatformId} from '../../base/common/platformId';
import type {CommandInvocationContext, CommandRegistry} from '../../core/commands/commandRegistry';
import {parseCommandArgs} from '../../core/parser/commandParser';
import type {MessagingPort} from '../../core/ports/messaging.port';
import type {RolePort} from '../../core/ports/role.port';
import type {ValkeyClient} from '../../platform/cache/valkeyClient';
import type {SleekConfigStore} from '../../platform/config/sleekConfig';
import type {DatabaseClient} from '../../platform/database/drizzleClient';
import {createServiceKey} from '../../platform/di/serviceKey';
import type {GovernanceService} from '../governance/governance.contract';
import type {SecurityService} from '../security/security.contract';

export const RELOAD_CONTROL_CHANNEL = 'sleek:control:reload';

export interface DeveloperSlashCommandSpec {
  readonly name: string;
  readonly description: string;
  readonly default_member_permissions: '0';
}

export const DEV_SLASH_COMMANDS: readonly DeveloperSlashCommandSpec[] = Object.freeze([
  {
    name: 'sudo',
    description: 'Execute any command with Level 5 bypass',
    default_member_permissions: '0',
  },
  {
    name: 'freeze',
    description: 'Freeze all bot actions in a guild',
    default_member_permissions: '0',
  },
  {name: 'unfreeze', description: 'Unfreeze a guild', default_member_permissions: '0'},
  {
    name: 'uncompromise',
    description: 'Neutralize a compromised staff/admin account',
    default_member_permissions: '0',
  },
  {
    name: 'stats',
    description: 'Display runtime and datastore diagnostics',
    default_member_permissions: '0',
  },
  {
    name: 'reload',
    description: 'Reload config/sleek.yaml and flush caches cluster-wide',
    default_member_permissions: '0',
  },
  {
    name: 'sql',
    description: 'Execute bounded read-only SQL diagnostics',
    default_member_permissions: '0',
  },
]);

export interface DeveloperModule {
  readonly registerCommands: (registry: CommandRegistry) => void;
}

export const DEVELOPER_MODULE_KEY = createServiceKey<DeveloperModule>('modules.developer');

export interface CreateDeveloperModuleOptions {
  readonly security: SecurityService;
  readonly governance: GovernanceService;
  readonly database: DatabaseClient | undefined;
  readonly valkey: ValkeyClient;
  readonly configStore: SleekConfigStore;
  readonly rolePort: RolePort;
  readonly messagingPort: MessagingPort;
  readonly registry: CommandRegistry;
}

function parseUserId(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(raw.trim());
  return match?.[1] ?? match?.[2];
}

function isSnowflake(raw: string | undefined): raw is string {
  return raw !== undefined && /^\d{17,20}$/.test(raw);
}

export function createDeveloperModule(options: CreateDeveloperModuleOptions): DeveloperModule {
  const {security, governance, database, valkey, configStore, rolePort, messagingPort, registry} =
    options;

  async function emitModlogAudit(
    platform: PlatformId,
    guildId: string,
    content: string,
  ): Promise<void> {
    const govState = await governance.getGuildState(platform, guildId);
    if (govState.modlogChannelId !== undefined) {
      await messagingPort.sendMessage({
        platform,
        channelId: govState.modlogChannelId,
        content,
      });
    }
  }

  async function handleSudo(ctx: CommandInvocationContext): Promise<void> {
    const trimmed = ctx.rawArgs.trim();
    if (trimmed.length === 0) {
      await ctx.reply('Usage: `,sudo [guild_id] <command...>`');
      return;
    }

    const firstSpace = trimmed.search(/\s/);
    const firstToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    let targetGuildId = ctx.guildId;
    let commandLine = trimmed;

    if (isSnowflake(firstToken) && firstSpace !== -1 && registry.get(firstToken) === undefined) {
      targetGuildId = firstToken;
      commandLine = trimmed.slice(firstSpace + 1).trim();
    }

    if (targetGuildId === undefined || commandLine.length === 0) {
      await ctx.reply('Target guild_id and command line are required.');
      return;
    }

    const cmdTokens = commandLine.split(/\s+/);
    const twoWord = cmdTokens.length >= 2 ? `${cmdTokens[0]} ${cmdTokens[1]}`.toLowerCase() : '';
    const oneWord = cmdTokens[0]?.toLowerCase() ?? '';
    const cmdDef = registry.get(twoWord) ?? registry.get(oneWord);

    if (cmdDef === undefined) {
      await ctx.reply(`Unknown command in sudo invocation: \`${oneWord}\`.`);
      return;
    }

    const usedWords = registry.get(twoWord) !== undefined ? 2 : 1;
    const rawSubArgs = cmdTokens.slice(usedWords).join(' ');
    const parsed = parseCommandArgs(rawSubArgs, {
      adaptiveModeration: cmdDef.adaptiveModeration,
      acceptsDuration: cmdDef.acceptsDuration,
    });

    await security.store.insertPlatformAuditLog({
      platform: ctx.platform,
      executorId: ctx.actorId,
      targetGuildId,
      commandExecuted: `,sudo ${commandLine}`,
      reason: parsed.reason ?? 'Level 5 Platform Override',
      payload: {command: cmdDef.name},
    });
    await emitModlogAudit(
      ctx.platform,
      targetGuildId,
      `[Platform Emergency Action] Level 5 sudo executed by <@${ctx.actorId}>: \`${cmdDef.name}\``,
    );

    await cmdDef.execute({
      ...ctx,
      guildId: targetGuildId,
      rawArgs: rawSubArgs,
      parsed,
      isSudo: true,
    });
  }

  async function handleFreeze(ctx: CommandInvocationContext, frozen: boolean): Promise<void> {
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    const targetGuildId = isSnowflake(tokens[0]) ? tokens[0] : ctx.guildId;
    if (targetGuildId === undefined) {
      await ctx.reply(`Usage: \`,${frozen ? 'freeze' : 'unfreeze'} <guild_id> [reason]\``);
      return;
    }

    const reasonTokens = isSnowflake(tokens[0]) ? tokens.slice(1) : tokens;
    const reasonJoined = reasonTokens.join(' ');
    const reason =
      reasonJoined.length > 0 ? reasonJoined : frozen ? 'Platform safety freeze' : 'Unfrozen';

    await governance.store.setGuildFrozen({
      platform: ctx.platform,
      guildId: targetGuildId,
      frozen,
      reason: frozen ? reason : undefined,
    });
    await governance.invalidateGuild(ctx.platform, targetGuildId);
    await security.store.insertPlatformAuditLog({
      platform: ctx.platform,
      executorId: ctx.actorId,
      targetGuildId,
      commandExecuted: frozen ? ',freeze' : ',unfreeze',
      reason,
      payload: {frozen},
    });
    await emitModlogAudit(
      ctx.platform,
      targetGuildId,
      `[Platform Emergency Action] Guild ${frozen ? 'frozen' : 'unfrozen'} by <@${ctx.actorId}>: ${reason}`,
    );

    await ctx.reply(`Guild \`${targetGuildId}\` is now ${frozen ? 'frozen' : 'unfrozen'}.`);
  }

  async function handleUncompromise(ctx: CommandInvocationContext): Promise<void> {
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    let targetGuildId = ctx.guildId;
    let userToken = tokens[0];
    let reasonStartIdx = 1;

    if (
      isSnowflake(tokens[0]) &&
      tokens[1] !== undefined &&
      isSnowflake(tokens[1].replace(/[<@!>]/g, ''))
    ) {
      targetGuildId = tokens[0];
      userToken = tokens[1];
      reasonStartIdx = 2;
    }

    const targetUserId = parseUserId(userToken);
    if (targetGuildId === undefined || targetUserId === undefined) {
      await ctx.reply('Usage: `,uncompromise [guild_id] <@user|user_id> [reason]`');
      return;
    }

    const reasonJoined = tokens.slice(reasonStartIdx).join(' ');
    const reason = reasonJoined.length > 0 ? reasonJoined : 'Compromised account containment';

    const [staffRoles, adminRoles] = await Promise.all([
      security.store.listStaffRoles(ctx.platform, targetGuildId, 'staff'),
      security.store.listStaffRoles(ctx.platform, targetGuildId, 'admin'),
    ]);
    const allBoundRoles = [...new Set([...staffRoles, ...adminRoles])];
    if (allBoundRoles.length > 0) {
      await rolePort.removeMemberRoles({
        platform: ctx.platform,
        guildId: targetGuildId,
        userId: targetUserId,
        roleIds: allBoundRoles,
        reason,
      });
    }

    const dbRes = await security.store.uncompromiseMember({
      platform: ctx.platform,
      guildId: targetGuildId,
      targetUserId,
    });
    await security.invalidateGuildCache(ctx.platform, targetGuildId);
    await security.store.insertPlatformAuditLog({
      platform: ctx.platform,
      executorId: ctx.actorId,
      targetGuildId,
      commandExecuted: ',uncompromise',
      reason,
      payload: {
        targetUserId,
        actingOwnerRevoked: dbRes.actingOwnerRevoked,
        strippedRoles: allBoundRoles.length,
      },
    });
    await emitModlogAudit(
      ctx.platform,
      targetGuildId,
      `[Platform Emergency Action] Uncompromised <@${targetUserId}> (actingOwnerRevoked=${String(dbRes.actingOwnerRevoked)}, roles=${allBoundRoles.length}): ${reason}`,
    );

    await ctx.reply(
      `Uncompromised <@${targetUserId}> in \`${targetGuildId}\` (ActingOwner revoked: ${String(dbRes.actingOwnerRevoked)}, bound roles stripped: ${allBoundRoles.length}).`,
    );
  }

  async function handleStats(ctx: CommandInvocationContext): Promise<void> {
    const mem = process.memoryUsage();
    const rssMb = Math.round((mem.rss / 1024 / 1024) * 10) / 10;
    const heapMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
    const dbOk = database !== undefined ? await database.healthCheck() : false;
    const valkeyOk = await valkey.healthCheck();
    const policy = configStore.get();

    await ctx.reply(
      `Sleek Stats | RSS: ${rssMb}MB | Heap: ${heapMb}MB | DB: ${dbOk ? 'OK' : 'N/A'} | Valkey: ${valkeyOk ? 'OK' : 'DOWN'} | Policy v${policy.version}`,
    );
  }

  async function handleReload(ctx: CommandInvocationContext): Promise<void> {
    const next = await configStore.reload();
    security.flushAllCaches();
    governance.flushAllCaches();
    await valkey.publish(
      RELOAD_CONTROL_CHANNEL,
      JSON.stringify({version: next.version, at: Date.now()}),
    );
    await ctx.reply(
      `Reloaded Sleek YAML policy (v${next.version}) and flushed caches cluster-wide.`,
    );
  }

  async function handleSql(ctx: CommandInvocationContext): Promise<void> {
    if (database === undefined) {
      await ctx.reply('Database client is not attached in this runtime.');
      return;
    }
    const query = ctx.rawArgs.trim();
    if (query.length === 0) {
      await ctx.reply('Usage: `,sql <SELECT ...>`');
      return;
    }
    const {sqlTimeoutMs, sqlMaxRows} = configStore.get().developer;
    try {
      const result = await database.executeReadOnlySql(query, sqlTimeoutMs, sqlMaxRows);
      const preview = JSON.stringify(result.rows, null, 2).slice(0, 1800);
      await ctx.reply(
        `Rows: ${result.rows.length}${result.truncated ? ` (truncated to ${sqlMaxRows})` : ''}\n\`\`\`json\n${preview}\n\`\`\``,
      );
    } catch (error: unknown) {
      await ctx.reply(`SQL error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleBotStaff(ctx: CommandInvocationContext): Promise<void> {
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    const sub = tokens[0]?.toLowerCase() ?? 'list';

    if (sub === 'list') {
      const staff = await security.store.listPlatformStaff(ctx.platform);
      if (staff.length === 0) {
        await ctx.reply('No global bot staff registered.');
        return;
      }
      await ctx.reply(staff.map(s => `<@${s.userId}> — \`${s.tier}\``).join('\n'));
      return;
    }

    if (sub === 'add') {
      const targetId = parseUserId(tokens[1]);
      const tierRaw = tokens[2]?.toLowerCase();
      if (
        targetId === undefined ||
        (tierRaw !== 'support' && tierRaw !== 'tns' && tierRaw !== 'admin')
      ) {
        await ctx.reply('Usage: `,botstaff add <@user|id> <support|tns|admin>`');
        return;
      }
      await security.store.upsertPlatformStaff({
        platform: ctx.platform,
        userId: targetId,
        tier: tierRaw,
        grantedNodes: [],
        addedBy: ctx.actorId,
      });
      await ctx.reply(`Appointed <@${targetId}> to Global Bot Staff (\`${tierRaw}\`).`);
      return;
    }

    if (sub === 'remove') {
      const targetId = parseUserId(tokens[1]);
      if (targetId === undefined) {
        await ctx.reply('Usage: `,botstaff remove <@user|id>`');
        return;
      }
      const removed = await security.store.removePlatformStaff(ctx.platform, targetId);
      await ctx.reply(
        removed
          ? `Removed <@${targetId}> from Global Bot Staff.`
          : `<@${targetId}> is not in Global Bot Staff.`,
      );
      return;
    }

    await ctx.reply('Usage: `,botstaff <add|remove|list>`');
  }

  return {
    registerCommands: (cmdRegistry: CommandRegistry): void => {
      cmdRegistry.register({
        name: 'sudo',
        moduleId: 'developer',
        permissionNode: 'bot.sudo.exec',
        description: 'Execute any command with Level 5 bypass',
        mutatesState: true,
        execute: handleSudo,
      });
      cmdRegistry.register({
        name: 'freeze',
        moduleId: 'developer',
        permissionNode: 'bot.guilds.freeze',
        description: 'Freeze all bot commands in a guild',
        mutatesState: true,
        execute: async ctx => handleFreeze(ctx, true),
      });
      cmdRegistry.register({
        name: 'unfreeze',
        moduleId: 'developer',
        permissionNode: 'bot.guilds.freeze',
        description: 'Lift a platform safety freeze on a guild',
        mutatesState: true,
        execute: async ctx => handleFreeze(ctx, false),
      });
      cmdRegistry.register({
        name: 'uncompromise',
        moduleId: 'developer',
        permissionNode: 'bot.developer.root',
        description: 'Neutralize a compromised admin or Acting Owner account',
        mutatesState: true,
        execute: handleUncompromise,
      });
      cmdRegistry.register({
        name: 'stats',
        moduleId: 'developer',
        permissionNode: 'bot.system.stats',
        description: 'Display platform runtime and datastore metrics',
        mutatesState: false,
        execute: handleStats,
      });
      cmdRegistry.register({
        name: 'reload',
        moduleId: 'developer',
        permissionNode: 'bot.system.reload',
        description: 'Reload config/sleek.yaml and flush caches cluster-wide',
        mutatesState: true,
        execute: handleReload,
      });
      cmdRegistry.register({
        name: 'sql',
        moduleId: 'developer',
        permissionNode: 'bot.sql',
        description: 'Run bounded read-only SQL query',
        mutatesState: false,
        execute: handleSql,
      });
      cmdRegistry.register({
        name: 'botstaff',
        moduleId: 'developer',
        permissionNode: 'bot.staff.manage',
        description: 'Manage global bot staff tiers',
        mutatesState: true,
        execute: handleBotStaff,
      });
    },
  };
}
