import type {
  CommandInvocationContext,
  CommandRegistry,
} from '../../../core/commands/commandRegistry';
import {type GovernanceDeps, handleAlias, handlePrefix} from './governancePrefixAlias';

const PROTECTED_COMMANDS = new Set([
  'enablecommand',
  'ecmd',
  'enablemodule',
  'em',
  'actingowner',
  'antinuke',
  'help',
  'sudo',
  'freeze',
  'unfreeze',
]);

const PROTECTED_MODULES = new Set(['governance', 'security', 'developer', 'antinuke']);

function parseTargetMention(raw: string | undefined): {
  readonly kind: 'channel' | 'role' | 'user' | 'unknown';
  readonly id: string | undefined;
} {
  if (raw === undefined) {
    return {kind: 'unknown', id: undefined};
  }
  const chan = /^<#(\d{17,20})>$/.exec(raw);
  if (chan?.[1] !== undefined) {
    return {kind: 'channel', id: chan[1]};
  }
  const role = /^<@&(\d{17,20})>$/.exec(raw);
  if (role?.[1] !== undefined) {
    return {kind: 'role', id: role[1]};
  }
  const user = /^<@!?(\d{17,20})>$/.exec(raw);
  if (user?.[1] !== undefined) {
    return {kind: 'user', id: user[1]};
  }
  if (/^\d{17,20}$/.test(raw)) {
    return {kind: 'unknown', id: raw};
  }
  return {kind: 'unknown', id: undefined};
}

async function handleCommandToggle(
  deps: GovernanceDeps,
  ctx: CommandInvocationContext,
  disable: boolean,
): Promise<void> {
  if (ctx.guildId === undefined) {
    await ctx.reply('Guild context required.');
    return;
  }
  const tokens = ctx.rawArgs
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  if (tokens.length < 2) {
    await ctx.reply(`Usage: \`,${disable ? 'dcmd' : 'ecmd'} <#channel|@user|@role> <command>\``);
    return;
  }
  const target = parseTargetMention(tokens[0]);
  const cmdName = tokens[1]?.toLowerCase() ?? '';
  if (target.id === undefined || cmdName.length === 0) {
    await ctx.reply('Invalid target or command name.');
    return;
  }
  if (disable && PROTECTED_COMMANDS.has(cmdName)) {
    await ctx.reply(`Safety Floor: command \`${cmdName}\` cannot be disabled.`);
    return;
  }

  const scopeType =
    target.kind === 'channel' ? 'channel' : target.kind === 'role' ? 'role' : 'user';

  await deps.store.setCommandDisabled({
    platform: ctx.platform,
    guildId: ctx.guildId,
    commandName: cmdName,
    scopeType,
    scopeId: target.id,
    disabled: disable,
    actorId: ctx.actorId,
  });
  await deps.invalidateGuild(ctx.platform, ctx.guildId);
  await ctx.reply(
    `${disable ? 'Disabled' : 'Enabled'} command \`${cmdName}\` for ${scopeType} ${target.id}.`,
  );
}

async function handleModuleToggle(
  deps: GovernanceDeps,
  ctx: CommandInvocationContext,
  disable: boolean,
): Promise<void> {
  if (ctx.guildId === undefined) {
    await ctx.reply('Guild context required.');
    return;
  }
  const tokens = ctx.rawArgs
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  if (tokens.length < 2) {
    await ctx.reply(`Usage: \`,${disable ? 'dm' : 'em'} <#channel|@role> <module>\``);
    return;
  }
  const target = parseTargetMention(tokens[0]);
  const moduleId = tokens[1]?.toLowerCase() ?? '';
  if (target.id === undefined || moduleId.length === 0) {
    await ctx.reply('Invalid target or module name.');
    return;
  }
  if (disable && PROTECTED_MODULES.has(moduleId)) {
    await ctx.reply(`Safety Floor: module \`${moduleId}\` cannot be disabled.`);
    return;
  }

  const scopeType = target.kind === 'role' ? 'role' : 'channel';
  await deps.store.setModuleDisabled({
    platform: ctx.platform,
    guildId: ctx.guildId,
    moduleId,
    scopeType,
    scopeId: target.id,
    disabled: disable,
    actorId: ctx.actorId,
  });
  await deps.invalidateGuild(ctx.platform, ctx.guildId);
  await ctx.reply(
    `${disable ? 'Disabled' : 'Enabled'} module \`${moduleId}\` for ${scopeType} ${target.id}.`,
  );
}

async function handleIgnore(deps: GovernanceDeps, ctx: CommandInvocationContext): Promise<void> {
  if (ctx.guildId === undefined) {
    await ctx.reply('Guild context required.');
    return;
  }
  const tokens = ctx.rawArgs
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  const sub = tokens[0]?.toLowerCase() ?? 'list';

  if (sub === 'list') {
    const state = await deps.getGuildState(ctx.platform, ctx.guildId);
    const chans =
      state.ignoredChannels.size > 0
        ? [...state.ignoredChannels].map(c => `<#${c}>`).join(', ')
        : 'None';
    const users =
      state.ignoredUsers.size > 0 ? [...state.ignoredUsers].map(u => `<@${u}>`).join(', ') : 'None';
    await ctx.reply(`Ignored channels: ${chans}\nIgnored users: ${users}`);
    return;
  }

  if (sub === 'add' || sub === 'remove') {
    const target = parseTargetMention(tokens[1]);
    if (target.id === undefined || (target.kind !== 'channel' && target.kind !== 'user')) {
      await ctx.reply(`Usage: \`,ignore ${sub} <#channel|@user>\``);
      return;
    }
    await deps.store.toggleIgnoredTarget({
      platform: ctx.platform,
      guildId: ctx.guildId,
      targetType: target.kind,
      targetId: target.id,
      add: sub === 'add',
      actorId: ctx.actorId,
    });
    await deps.invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply(
      `${sub === 'add' ? 'Added' : 'Removed'} ${target.kind} ${target.id} ${sub === 'add' ? 'to' : 'from'} ignore list.`,
    );
    return;
  }

  await ctx.reply('Usage: `,ignore <add|remove|list> [#channel|@user]`');
}

export function registerGovernanceCommands(registry: CommandRegistry, deps: GovernanceDeps): void {
  registry.register({
    name: 'prefix',
    moduleId: 'governance',
    permissionNode: 'server.prefix.manage',
    description: 'View or manage guild and personal command prefixes',
    mutatesState: true,
    execute: async ctx => handlePrefix(deps, ctx),
  });
  registry.register({
    name: 'prefix self',
    moduleId: 'governance',
    permissionNode: 'user.prefix.self',
    description: 'Set personal command prefix',
    mutatesState: false,
    execute: async ctx => handlePrefix(deps, ctx),
  });
  registry.register({
    name: 'alias',
    moduleId: 'governance',
    permissionNode: 'server.alias.manage',
    description: 'Manage custom guild and personal command aliases',
    mutatesState: true,
    execute: async ctx => handleAlias(deps, ctx, registry),
  });
  registry.register({
    name: 'alias list',
    moduleId: 'governance',
    permissionNode: 'server.alias.view',
    description: 'List guild command aliases',
    mutatesState: false,
    execute: async ctx => handleAlias(deps, ctx, registry),
  });
  registry.register({
    name: 'alias user add',
    moduleId: 'governance',
    permissionNode: 'server.alias.user',
    description: 'Create personal cross-guild command alias',
    mutatesState: false,
    execute: async ctx => handleAlias(deps, ctx, registry),
  });
  registry.register({
    name: 'disablecommand',
    moduleId: 'governance',
    permissionNode: 'server.governance.commands',
    description: 'Disable a command in a channel or for a target',
    mutatesState: true,
    execute: async ctx => handleCommandToggle(deps, ctx, true),
  });
  registry.register({
    name: 'enablecommand',
    moduleId: 'governance',
    permissionNode: 'server.governance.commands',
    description: 'Re-enable a command in a channel or for a target',
    mutatesState: true,
    execute: async ctx => handleCommandToggle(deps, ctx, false),
  });
  registry.register({
    name: 'disablemodule',
    moduleId: 'governance',
    permissionNode: 'server.governance.modules',
    description: 'Disable an entire module in a channel or for a role',
    mutatesState: true,
    execute: async ctx => handleModuleToggle(deps, ctx, true),
  });
  registry.register({
    name: 'enablemodule',
    moduleId: 'governance',
    permissionNode: 'server.governance.modules',
    description: 'Re-enable an entire module in a channel or for a role',
    mutatesState: true,
    execute: async ctx => handleModuleToggle(deps, ctx, false),
  });
  registry.register({
    name: 'ignore',
    moduleId: 'governance',
    permissionNode: 'server.ignore.manage',
    description: 'Ignore channels or members from bot command triggers',
    mutatesState: true,
    execute: async ctx => handleIgnore(deps, ctx),
  });
}
