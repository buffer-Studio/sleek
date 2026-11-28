import type {PlatformId} from '../../../base/common/platformId';
import type {
  CommandInvocationContext,
  CommandRegistry,
} from '../../../core/commands/commandRegistry';
import {splitMacroChain} from '../../../core/parser/aliasInterpolator';
import {COMMAND_FLAG_BIT, hasFlagBit} from '../../../core/parser/commandFlagBits';
import {SOVEREIGN_CORE_TRIGGERS} from '../../../core/parser/commandPrecedence';
import type {SleekConfigStore} from '../../../platform/config/sleekConfig';
import type {GovernanceStore, GuildGovernanceState} from '../governance.contract';

export interface GovernanceDeps {
  readonly store: GovernanceStore;
  readonly configStore: SleekConfigStore;
  readonly getGuildState: (platform: PlatformId, guildId: string) => Promise<GuildGovernanceState>;
  readonly invalidateGuild: (platform: PlatformId, guildId: string) => Promise<void>;
}

export async function handlePrefix(
  deps: GovernanceDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
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
    const state = await deps.getGuildState(ctx.platform, ctx.guildId);
    const personal = await deps.store.getPersonalPrefix(ctx.platform, ctx.actorId);
    await ctx.reply(
      `Guild prefix: \`${state.prefix}\` (comma fallback: ${state.fallbackCommaDisabled ? 'disabled' : 'enabled'})${personal !== undefined ? ` | Personal prefix: \`${personal}\`` : ''}`,
    );
    return;
  }

  if (sub === 'remove') {
    await deps.store.resetGuildPrefix(ctx.platform, ctx.guildId);
    await deps.invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply('Reset guild prefix to `,`.');
    return;
  }

  const maxLen = deps.configStore.get().prefixes.maxLength;
  if (sub === 'self') {
    const nextPrefix = tokens[1];
    if (nextPrefix === undefined || nextPrefix.length === 0 || nextPrefix.length > maxLen) {
      await ctx.reply(`Personal prefix must be 1 to ${maxLen} characters.`);
      return;
    }
    await deps.store.setPersonalPrefix(ctx.platform, ctx.actorId, nextPrefix);
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
    await deps.store.setGuildPrefix({
      platform: ctx.platform,
      guildId: ctx.guildId,
      prefix: nextPrefix,
      fallbackCommaDisabled: disableFallback,
    });
    await deps.invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply(
      `Updated guild prefix to \`${nextPrefix}\` (comma fallback ${disableFallback ? 'disabled' : 'enabled'}).`,
    );
    return;
  }

  await ctx.reply('Usage: `,prefix <set|remove|self|view> [value] [--fallback]`');
}

export async function handleAlias(
  deps: GovernanceDeps,
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
    const state = await deps.getGuildState(ctx.platform, ctx.guildId);
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
    const state = await deps.getGuildState(ctx.platform, ctx.guildId);
    const target = state.guildAliases[shortcut];
    await ctx.reply(
      target === undefined
        ? `No guild alias found for \`${shortcut}\`.`
        : `Alias \`${shortcut}\` -> \`${target}\``,
    );
    return;
  }

  if (sub === 'reset') {
    await deps.store.resetGuildAliases(ctx.platform, ctx.guildId);
    await deps.invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply('Cleared all custom guild aliases.');
    return;
  }

  if (sub === 'remove' || sub === 'delete') {
    const shortcut = tokens[1]?.toLowerCase();
    if (shortcut === undefined) {
      await ctx.reply('Usage: `,alias remove <shortcut>`');
      return;
    }
    const removed = await deps.store.removeGuildAlias(ctx.platform, ctx.guildId, shortcut);
    await deps.invalidateGuild(ctx.platform, ctx.guildId);
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
    const policy = deps.configStore.get().aliases;
    const currentUserAliases = await deps.store.getUserAliases(ctx.platform, ctx.actorId);
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
    await deps.store.upsertUserAlias({
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
    const state = await deps.getGuildState(ctx.platform, ctx.guildId);
    const policy = deps.configStore.get().aliases;
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
    await deps.store.upsertGuildAlias({
      platform: ctx.platform,
      guildId: ctx.guildId,
      shortcut,
      targetCommand: targetRaw,
      actorId: ctx.actorId,
    });
    await deps.invalidateGuild(ctx.platform, ctx.guildId);
    await ctx.reply(`Created guild alias \`${shortcut}\` -> \`${targetRaw}\`.`);
    return;
  }

  await ctx.reply('Usage: `,alias <add|remove|list|view|reset|user add>`');
}
