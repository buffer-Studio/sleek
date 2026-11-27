import type {PlatformId} from '../../base/common/platformId';
import type {CommandInvocationContext, CommandRegistry} from '../../core/commands/commandRegistry';
import {COMMAND_FLAG_BIT, hasFlagBit} from '../../core/parser/commandFlagBits';
import {splitMacroChain} from '../../core/parser/aliasInterpolator';
import {SOVEREIGN_CORE_TRIGGERS} from '../../core/parser/commandPrecedence';
import {
  buildCooldownKey,
  type CooldownUserState,
  type CooldownVerdict,
  createEmptyCooldownState,
  evaluateCooldownState,
} from '../../core/ratelimit/cooldownEngine';
import {TieredCache} from '../../platform/cache/tieredCache';
import type {ValkeyClient} from '../../platform/cache/valkeyClient';
import type {SleekConfigStore} from '../../platform/config/sleekConfig';
import type {GovernanceService, GovernanceStore, GuildGovernanceState} from './governance.contract';

const GOV_INVALIDATION_CHANNEL = 'channel:governance:invalidate';

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

export interface CreateGovernanceServiceOptions {
  readonly store: GovernanceStore;
  readonly valkey: ValkeyClient;
  readonly configStore: SleekConfigStore;
}

export function createGovernanceService(
  options: CreateGovernanceServiceOptions,
): GovernanceService {
  const {store, valkey, configStore} = options;
  const cache = new TieredCache<string, GuildGovernanceState>({
    l1MaxEntries: 10_000,
    l1TtlMs: 60_000,
  });
  const localCooldowns = new Map<string, CooldownUserState>();

  async function getGuildState(
    platform: PlatformId,
    guildId: string,
  ): Promise<GuildGovernanceState> {
    const key = `${platform}:${guildId}`;
    const loaded = await cache.getOrLoad(key, async () =>
      store.getGuildGovernanceState(platform, guildId),
    );
    if (loaded === undefined) {
      return store.getGuildGovernanceState(platform, guildId);
    }
    return loaded;
  }

  async function invalidateGuild(platform: PlatformId, guildId: string): Promise<void> {
    const key = `${platform}:${guildId}`;
    cache.invalidate(key);
    await valkey.publish(GOV_INVALIDATION_CHANNEL, key);
  }

  async function checkCooldown(args: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly commandName: string;
    readonly isDeveloper: boolean;
  }): Promise<CooldownVerdict> {
    const policy = configStore.get();
    const key = buildCooldownKey(args.platform, args.guildId, args.userId);
    const current = localCooldowns.get(key) ?? createEmptyCooldownState();
    const result = evaluateCooldownState({
      state: current,
      commandName: args.commandName,
      policy: policy.cooldowns,
      isDeveloper: args.isDeveloper,
      developerBypassEnabled: policy.developer.bypassCooldowns,
      nowMs: Date.now(),
    });
    localCooldowns.set(key, result.nextState);
    if (result.verdict.status !== 'bypass_developer') {
      await valkey.set(key, JSON.stringify(result.nextState), 60);
    }
    return result.verdict;
  }

  function isCommandDisabledInContext(args: {
    readonly state: GuildGovernanceState;
    readonly commandName: string;
    readonly moduleId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly actorRoleIds: readonly string[];
  }): boolean {
    const mod = args.moduleId.toLowerCase();
    const cmd = args.commandName.toLowerCase();

    if (
      args.state.disabledModules.has(`${mod}:guild:${args.channelId}`) ||
      args.state.disabledModules.has(`${mod}:guild:0`) ||
      args.state.disabledModules.has(`${mod}:channel:${args.channelId}`)
    ) {
      return true;
    }
    for (const roleId of args.actorRoleIds) {
      if (args.state.disabledModules.has(`${mod}:role:${roleId}`)) {
        return true;
      }
      if (args.state.disabledCommands.has(`${cmd}:role:${roleId}`)) {
        return true;
      }
    }

    return (
      args.state.disabledCommands.has(`${cmd}:guild:0`) ||
      args.state.disabledCommands.has(`${cmd}:channel:${args.channelId}`) ||
      args.state.disabledCommands.has(`${cmd}:user:${args.actorId}`)
    );
  }

  async function handlePrefix(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Guild context required.');
      return;
    }
    const tokens = ctx.rawArgs
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    const sub = tokens[0]?.toLowerCase() ?? 'view';

    if (sub === 'view') {
      const state = await getGuildState(ctx.platform, ctx.guildId);
      const personal = await store.getPersonalPrefix(ctx.platform, ctx.actorId);
      await ctx.reply(
        `Guild prefix: \`${state.prefix}\` (comma fallback: ${state.fallbackCommaDisabled ? 'disabled' : 'enabled'})${personal !== undefined ? ` | Personal prefix: \`${personal}\`` : ''}`,
      );
      return;
    }

    if (sub === 'remove') {
      await store.resetGuildPrefix(ctx.platform, ctx.guildId);
      await invalidateGuild(ctx.platform, ctx.guildId);
      await ctx.reply('Reset guild prefix to `,`.');
      return;
    }

    const maxLen = configStore.get().prefixes.maxLength;
    if (sub === 'self') {
      const nextPrefix = tokens[1];
      if (nextPrefix === undefined || nextPrefix.length === 0 || nextPrefix.length > maxLen) {
        await ctx.reply(`Personal prefix must be 1 to ${maxLen} characters.`);
        return;
      }
      await store.setPersonalPrefix(ctx.platform, ctx.actorId, nextPrefix);
      await ctx.reply(`Set personal prefix to \`${nextPrefix}\`.`);
      return;
    }

    if (sub === 'set') {
      const nextPrefix = tokens.slice(1).find(t => !t.startsWith('--'));
      if (nextPrefix === undefined || nextPrefix.length === 0 || nextPrefix.length > maxLen) {
        await ctx.reply(`Guild prefix must be 1 to ${maxLen} characters.`);
        return;
      }
      const disableFallback = hasFlagBit(ctx.parsed.flagsMask, COMMAND_FLAG_BIT.Fallback);
      await store.setGuildPrefix({
        platform: ctx.platform,
        guildId: ctx.guildId,
        prefix: nextPrefix,
        fallbackCommaDisabled: disableFallback,
      });
      await invalidateGuild(ctx.platform, ctx.guildId);
      await ctx.reply(
        `Updated guild prefix to \`${nextPrefix}\` (comma fallback ${disableFallback ? 'disabled' : 'enabled'}).`,
      );
      return;
    }

    await ctx.reply('Usage: `,prefix <set|remove|self|view> [value] [--fallback]`');
  }

  async function handleAlias(
    ctx: CommandInvocationContext,
    registry: CommandRegistry,
  ): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Guild context required.');
      return;
    }
    const trimmed = ctx.rawArgs.trim();
    const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
    const sub = tokens[0]?.toLowerCase() ?? 'list';

    if (sub === 'list') {
      const state = await getGuildState(ctx.platform, ctx.guildId);
      const entries = Object.entries(state.guildAliases);
      if (entries.length === 0) {
        await ctx.reply('No custom guild aliases configured.');
        return;
      }
      await ctx.reply(entries.map(([k, v]) => `\`${k}\` -> \`${v}\``).join('\n'));
      return;
    }

    if (sub === 'view') {
      const shortcut = tokens[1]?.toLowerCase();
      if (shortcut === undefined) {
        await ctx.reply('Usage: `,alias view <shortcut>`');
        return;
      }
      const state = await getGuildState(ctx.platform, ctx.guildId);
      const target = state.guildAliases[shortcut];
      await ctx.reply(
        target === undefined
          ? `No guild alias found for \`${shortcut}\`.`
          : `Alias \`${shortcut}\` -> \`${target}\``,
      );
      return;
    }

    if (sub === 'reset') {
      await store.resetGuildAliases(ctx.platform, ctx.guildId);
      await invalidateGuild(ctx.platform, ctx.guildId);
      await ctx.reply('Cleared all custom guild aliases.');
      return;
    }

    if (sub === 'remove' || sub === 'delete') {
      const shortcut = tokens[1]?.toLowerCase();
      if (shortcut === undefined) {
        await ctx.reply('Usage: `,alias remove <shortcut>`');
        return;
      }
      const removed = await store.removeGuildAlias(ctx.platform, ctx.guildId, shortcut);
      await invalidateGuild(ctx.platform, ctx.guildId);
      await ctx.reply(
        removed ? `Removed alias \`${shortcut}\`.` : `Alias \`${shortcut}\` does not exist.`,
      );
      return;
    }

    if (sub === 'user' && tokens[1]?.toLowerCase() === 'add') {
      const shortcut = tokens[2]?.toLowerCase();
      const targetRaw = tokens.slice(3).join(' ');
      if (shortcut === undefined || targetRaw.length === 0) {
        await ctx.reply('Usage: `,alias user add <shortcut> <command>`');
        return;
      }
      const policy = configStore.get().aliases;
      const currentUserAliases = await store.getUserAliases(ctx.platform, ctx.actorId);
      if (
        currentUserAliases[shortcut] === undefined &&
        Object.keys(currentUserAliases).length >= policy.personalAliasCapNoVote
      ) {
        await ctx.reply(`Personal alias limit (${policy.personalAliasCapNoVote}) reached.`);
        return;
      }
      const steps = splitMacroChain(targetRaw, policy.maxMacroSteps);
      const rootCmd = steps[0]?.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (rootCmd.length === 0 || registry.get(rootCmd) === undefined) {
        await ctx.reply(`Unknown root command '${rootCmd}'.`);
        return;
      }
      await store.upsertUserAlias({
        platform: ctx.platform,
        userId: ctx.actorId,
        shortcut,
        targetCommand: targetRaw,
      });
      await ctx.reply(`Saved personal alias \`${shortcut}\` -> \`${targetRaw}\`.`);
      return;
    }

    if (sub === 'add') {
      const shortcut = tokens[1]?.toLowerCase();
      const targetRaw = tokens.slice(2).join(' ');
      if (shortcut === undefined || targetRaw.length === 0) {
        await ctx.reply('Usage: `,alias add <shortcut> <command>`');
        return;
      }
      if (SOVEREIGN_CORE_TRIGGERS.has(shortcut)) {
        await ctx.reply(`Cannot shadow sovereign core command \`${shortcut}\`.`);
        return;
      }
      const state = await getGuildState(ctx.platform, ctx.guildId);
      const policy = configStore.get().aliases;
      if (
        state.guildAliases[shortcut] === undefined &&
        Object.keys(state.guildAliases).length >= policy.freeGuildAliasCap
      ) {
        await ctx.reply(`Guild alias cap (${policy.freeGuildAliasCap}) reached.`);
        return;
      }
      const steps = splitMacroChain(targetRaw, policy.maxMacroSteps);
      const rootCmd = steps[0]?.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (rootCmd.length === 0 || registry.get(rootCmd) === undefined) {
        await ctx.reply(`Unknown root command '${rootCmd}'.`);
        return;
      }
      await store.upsertGuildAlias({
        platform: ctx.platform,
        guildId: ctx.guildId,
        shortcut,
        targetCommand: targetRaw,
        actorId: ctx.actorId,
      });
      await invalidateGuild(ctx.platform, ctx.guildId);
      await ctx.reply(`Created guild alias \`${shortcut}\` -> \`${targetRaw}\`.`);
      return;
    }

    await ctx.reply('Usage: `,alias <add|remove|list|view|reset|user add>`');
  }

  async function handleCommandToggle(
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

    await store.setCommandDisabled({
      platform: ctx.platform,
      guildId: ctx.guildId,
      commandName: cmdName,
      scopeType,
      scopeId: target.id,
      disabled: disable,
      actorId: ctx.actorId,
    });
    await invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply(
      `${disable ? 'Disabled' : 'Enabled'} command \`${cmdName}\` for ${scopeType} ${target.id}.`,
    );
  }

  async function handleModuleToggle(
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
    await store.setModuleDisabled({
      platform: ctx.platform,
      guildId: ctx.guildId,
      moduleId,
      scopeType,
      scopeId: target.id,
      disabled: disable,
      actorId: ctx.actorId,
    });
    await invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply(
      `${disable ? 'Disabled' : 'Enabled'} module \`${moduleId}\` for ${scopeType} ${target.id}.`,
    );
  }

  async function handleIgnore(ctx: CommandInvocationContext): Promise<void> {
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
      const state = await getGuildState(ctx.platform, ctx.guildId);
      const chans =
        state.ignoredChannels.size > 0
          ? [...state.ignoredChannels].map(c => `<#${c}>`).join(', ')
          : 'None';
      const users =
        state.ignoredUsers.size > 0
          ? [...state.ignoredUsers].map(u => `<@${u}>`).join(', ')
          : 'None';
      await ctx.reply(`Ignored channels: ${chans}\nIgnored users: ${users}`);
      return;
    }

    if (sub === 'add' || sub === 'remove') {
      const target = parseTargetMention(tokens[1]);
      if (target.id === undefined || (target.kind !== 'channel' && target.kind !== 'user')) {
        await ctx.reply(`Usage: \`,ignore ${sub} <#channel|@user>\``);
        return;
      }
      await store.toggleIgnoredTarget({
        platform: ctx.platform,
        guildId: ctx.guildId,
        targetType: target.kind,
        targetId: target.id,
        add: sub === 'add',
        actorId: ctx.actorId,
      });
      await invalidateGuild(ctx.platform, ctx.guildId);
      await ctx.reply(
        `${sub === 'add' ? 'Added' : 'Removed'} ${target.kind} ${target.id} ${sub === 'add' ? 'to' : 'from'} ignore list.`,
      );
      return;
    }

    await ctx.reply('Usage: `,ignore <add|remove|list> [#channel|@user]`');
  }

  return {
    getGuildState,
    getPersonalPrefix: async (platform, userId) => store.getPersonalPrefix(platform, userId),
    getUserAliases: async (platform, userId) => store.getUserAliases(platform, userId),
    checkCooldown,
    isCommandDisabledInContext,
    invalidateGuild,
    flushAllCaches: (): void => {
      cache.clear();
      localCooldowns.clear();
    },
    store,
    registerCommands: (registry: CommandRegistry): void => {
      registry.register({
        name: 'prefix',
        moduleId: 'governance',
        permissionNode: 'server.prefix.manage',
        description: 'View or manage guild and personal command prefixes',
        mutatesState: true,
        execute: handlePrefix,
      });
      registry.register({
        name: 'prefix self',
        moduleId: 'governance',
        permissionNode: 'user.prefix.self',
        description: 'Set personal command prefix',
        mutatesState: false,
        execute: handlePrefix,
      });
      registry.register({
        name: 'alias',
        moduleId: 'governance',
        permissionNode: 'server.alias.manage',
        description: 'Manage custom guild and personal command aliases',
        mutatesState: true,
        execute: async ctx => handleAlias(ctx, registry),
      });
      registry.register({
        name: 'alias list',
        moduleId: 'governance',
        permissionNode: 'server.alias.view',
        description: 'List guild command aliases',
        mutatesState: false,
        execute: async ctx => handleAlias(ctx, registry),
      });
      registry.register({
        name: 'alias user add',
        moduleId: 'governance',
        permissionNode: 'server.alias.user',
        description: 'Create personal cross-guild command alias',
        mutatesState: false,
        execute: async ctx => handleAlias(ctx, registry),
      });
      registry.register({
        name: 'disablecommand',
        moduleId: 'governance',
        permissionNode: 'server.governance.commands',
        description: 'Disable a command in a channel or for a target',
        mutatesState: true,
        execute: async ctx => handleCommandToggle(ctx, true),
      });
      registry.register({
        name: 'enablecommand',
        moduleId: 'governance',
        permissionNode: 'server.governance.commands',
        description: 'Re-enable a command in a channel or for a target',
        mutatesState: true,
        execute: async ctx => handleCommandToggle(ctx, false),
      });
      registry.register({
        name: 'disablemodule',
        moduleId: 'governance',
        permissionNode: 'server.governance.modules',
        description: 'Disable an entire module in a channel or for a role',
        mutatesState: true,
        execute: async ctx => handleModuleToggle(ctx, true),
      });
      registry.register({
        name: 'enablemodule',
        moduleId: 'governance',
        permissionNode: 'server.governance.modules',
        description: 'Re-enable an entire module in a channel or for a role',
        mutatesState: true,
        execute: async ctx => handleModuleToggle(ctx, false),
      });
      registry.register({
        name: 'ignore',
        moduleId: 'governance',
        permissionNode: 'server.ignore.manage',
        description: 'Ignore channels or members from bot command triggers',
        mutatesState: true,
        execute: handleIgnore,
      });
    },
  };
}
