import type {
  CommandInvocationContext,
  CommandRegistry,
} from '../../../core/commands/commandRegistry';
import {
  type DeveloperDeps,
  handleFreeze,
  handleSudo,
  handleUncompromise,
  parseUserId,
} from './developerEmergency';

export const RELOAD_CONTROL_CHANNEL = 'sleek:control:reload';

async function handleStats(deps: DeveloperDeps, ctx: CommandInvocationContext): Promise<void> {
  const mem = process.memoryUsage();
  const rssMb = Math.round((mem.rss / 1024 / 1024) * 10) / 10;
  const heapMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
  const dbOk = deps.database !== undefined ? await deps.database.healthCheck() : false;
  const valkeyOk = await deps.valkey.healthCheck();
  const policy = deps.configStore.get();

  await ctx.reply(
    `Sleek Stats | RSS: ${rssMb}MB | Heap: ${heapMb}MB | DB: ${dbOk ? 'OK' : 'N/A'} | Valkey: ${valkeyOk ? 'OK' : 'DOWN'} | Policy v${policy.version}`,
  );
}

async function handleReload(deps: DeveloperDeps, ctx: CommandInvocationContext): Promise<void> {
  const next = await deps.configStore.reload();
  deps.security.flushAllCaches();
  deps.governance.flushAllCaches();
  await deps.valkey.publish(
    RELOAD_CONTROL_CHANNEL,
    JSON.stringify({version: next.version, at: Date.now()}),
  );
  await ctx.reply(`Reloaded Sleek YAML policy (v${next.version}) and flushed caches cluster-wide.`);
}

async function handleSql(deps: DeveloperDeps, ctx: CommandInvocationContext): Promise<void> {
  if (deps.database === undefined) {
    await ctx.reply('Database client is not attached in this runtime.');
    return;
  }
  const query = ctx.rawArgs.trim();
  if (query.length === 0) {
    await ctx.reply('Usage: `,sql <SELECT ...>`');
    return;
  }
  const {sqlTimeoutMs, sqlMaxRows} = deps.configStore.get().developer;
  try {
    const result = await deps.database.executeReadOnlySql(query, sqlTimeoutMs, sqlMaxRows);
    const preview = JSON.stringify(result.rows, null, 2).slice(0, 1800);
    await ctx.reply(
      `Rows: ${result.rows.length}${result.truncated ? ` (truncated to ${sqlMaxRows})` : ''}\n\`\`\`json\n${preview}\n\`\`\``,
    );
  } catch (error: unknown) {
    await ctx.reply(`SQL error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleBotStaff(deps: DeveloperDeps, ctx: CommandInvocationContext): Promise<void> {
  const tokens = ctx.rawArgs
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  const sub = tokens[0]?.toLowerCase() ?? 'list';

  if (sub === 'list') {
    const staff = await deps.security.store.listPlatformStaff(ctx.platform);
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
    await deps.security.store.upsertPlatformStaff({
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
    const removed = await deps.security.store.removePlatformStaff(ctx.platform, targetId);
    await ctx.reply(
      removed
        ? `Removed <@${targetId}> from Global Bot Staff.`
        : `<@${targetId}> is not in Global Bot Staff.`,
    );
    return;
  }

  await ctx.reply('Usage: `,botstaff <add|remove|list>`');
}

export function registerDeveloperCommands(cmdRegistry: CommandRegistry, deps: DeveloperDeps): void {
  cmdRegistry.register({
    name: 'sudo',
    moduleId: 'developer',
    permissionNode: 'bot.sudo.exec',
    description: 'Execute any command with Level 5 bypass',
    mutatesState: true,
    execute: async ctx => handleSudo(deps, ctx),
  });
  cmdRegistry.register({
    name: 'freeze',
    moduleId: 'developer',
    permissionNode: 'bot.guilds.freeze',
    description: 'Freeze all bot commands in a guild',
    mutatesState: true,
    execute: async ctx => handleFreeze(deps, ctx, true),
  });
  cmdRegistry.register({
    name: 'unfreeze',
    moduleId: 'developer',
    permissionNode: 'bot.guilds.freeze',
    description: 'Lift a platform safety freeze on a guild',
    mutatesState: true,
    execute: async ctx => handleFreeze(deps, ctx, false),
  });
  cmdRegistry.register({
    name: 'uncompromise',
    moduleId: 'developer',
    permissionNode: 'bot.developer.root',
    description: 'Neutralize a compromised admin or Acting Owner account',
    mutatesState: true,
    execute: async ctx => handleUncompromise(deps, ctx),
  });
  cmdRegistry.register({
    name: 'stats',
    moduleId: 'developer',
    permissionNode: 'bot.system.stats',
    description: 'Display platform runtime and datastore metrics',
    mutatesState: false,
    execute: async ctx => handleStats(deps, ctx),
  });
  cmdRegistry.register({
    name: 'reload',
    moduleId: 'developer',
    permissionNode: 'bot.system.reload',
    description: 'Reload config/sleek.yaml and flush caches cluster-wide',
    mutatesState: true,
    execute: async ctx => handleReload(deps, ctx),
  });
  cmdRegistry.register({
    name: 'sql',
    moduleId: 'developer',
    permissionNode: 'bot.sql',
    description: 'Run bounded read-only SQL query',
    mutatesState: false,
    execute: async ctx => handleSql(deps, ctx),
  });
  cmdRegistry.register({
    name: 'botstaff',
    moduleId: 'developer',
    permissionNode: 'bot.staff.manage',
    description: 'Manage global bot staff tiers',
    mutatesState: true,
    execute: async ctx => handleBotStaff(deps, ctx),
  });
}
