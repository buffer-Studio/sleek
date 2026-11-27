import type {PlatformId} from '../../base/common/platformId';
import {AuthorityLevel} from '../../core/auth/authorityLevel';
import type {CommandDefinition, CommandRegistry} from '../../core/commands/commandRegistry';
import {expandAliasInvocation} from '../../core/parser/aliasInterpolator';
import {parseCommandArgs} from '../../core/parser/commandParser';
import {resolveCommandPrecedence} from '../../core/parser/commandPrecedence';
import type {GovernanceService} from '../../modules/governance/governance.contract';
import type {SecurityService} from '../../modules/security/security.contract';
import type {SleekConfigStore} from '../../platform/config/sleekConfig';

export interface IncomingPrefixMessage {
  readonly platform: PlatformId;
  readonly guildId: string | undefined;
  readonly channelId: string;
  readonly actorId: string;
  readonly actorRoleIds: readonly string[];
  readonly guildOwnerId: string | undefined;
  readonly content: string;
  readonly botUserId?: string;
  readonly reply: (content: string) => Promise<void>;
}

export interface CommandDispatcherDeps {
  readonly commandRegistry: CommandRegistry;
  readonly security: SecurityService;
  readonly governance: GovernanceService;
  readonly configStore: SleekConfigStore;
}

function stripPrefix(
  content: string,
  candidates: readonly string[],
  botUserId: string | undefined,
): string | undefined {
  const trimmed = content.trim();
  if (botUserId !== undefined) {
    const mentionA = `<@${botUserId}>`;
    const mentionB = `<@!${botUserId}>`;
    if (trimmed.startsWith(mentionA)) {
      return trimmed.slice(mentionA.length).trim();
    }
    if (trimmed.startsWith(mentionB)) {
      return trimmed.slice(mentionB.length).trim();
    }
  }
  for (const prefix of candidates) {
    if (prefix.length > 0 && trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return undefined;
}

function matchCommandDefinition(
  registry: CommandRegistry,
  line: string,
): {readonly def: CommandDefinition; readonly rawArgs: string} | undefined {
  const parts = line.trim().split(/\s+/);
  if (parts.length >= 3) {
    const threeWord = `${parts[0]} ${parts[1]} ${parts[2]}`.toLowerCase();
    const def3 = registry.get(threeWord);
    if (def3 !== undefined) {
      return {def: def3, rawArgs: parts.slice(3).join(' ')};
    }
  }
  if (parts.length >= 2) {
    const twoWord = `${parts[0]} ${parts[1]}`.toLowerCase();
    const def2 = registry.get(twoWord);
    if (def2 !== undefined) {
      return {def: def2, rawArgs: parts.slice(2).join(' ')};
    }
  }
  const oneWord = parts[0]?.toLowerCase() ?? '';
  const def1 = registry.get(oneWord);
  if (def1 !== undefined) {
    return {def: def1, rawArgs: parts.slice(1).join(' ')};
  }
  return undefined;
}

export async function dispatchPrefixMessage(
  deps: CommandDispatcherDeps,
  msg: IncomingPrefixMessage,
): Promise<boolean> {
  const policy = deps.configStore.get();
  const isDeveloper = deps.security.isBotOwner(msg.platform, msg.actorId);
  const personalPrefix = await deps.governance.getPersonalPrefix(msg.platform, msg.actorId);
  const guildState =
    msg.guildId !== undefined
      ? await deps.governance.getGuildState(msg.platform, msg.guildId)
      : undefined;

  const prefixCandidates: string[] = [];
  if (personalPrefix !== undefined) {
    prefixCandidates.push(personalPrefix);
  }
  if (guildState !== undefined) {
    prefixCandidates.push(guildState.prefix);
    if (!guildState.fallbackCommaDisabled && guildState.prefix !== ',') {
      prefixCandidates.push(',');
    }
  } else {
    prefixCandidates.push(policy.prefixes.defaultPrefix);
  }

  const withoutPrefix = stripPrefix(
    msg.content,
    prefixCandidates,
    policy.prefixes.allowMentionFallback ? msg.botUserId : undefined,
  );
  if (withoutPrefix === undefined || withoutPrefix.length === 0) {
    return false;
  }

  // 1. ignore gate (L1+ and L5 exempt)
  if (msg.guildId !== undefined && guildState !== undefined) {
    const isIgnored =
      guildState.ignoredChannels.has(msg.channelId) || guildState.ignoredUsers.has(msg.actorId);
    if (isIgnored && !(isDeveloper && policy.developer.bypassIgnoreLists)) {
      const level = await deps.security.resolveActorLevel({
        platform: msg.platform,
        guildId: msg.guildId,
        userId: msg.actorId,
        guildOwnerId: msg.guildOwnerId,
        roleIds: msg.actorRoleIds,
      });
      if (level < AuthorityLevel.BoundStaff) {
        return false;
      }
    }
  }

  // extract raw trigger + args
  const firstSpace = withoutPrefix.search(/\s/);
  const rawTrigger = firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace);
  const rawTail = firstSpace === -1 ? '' : withoutPrefix.slice(firstSpace + 1).trim();

  // 2. cooldown & abuse gate (L5 0ms bypass)
  const cooldown = await deps.governance.checkCooldown({
    platform: msg.platform,
    guildId: msg.guildId ?? 'global',
    userId: msg.actorId,
    commandName: rawTrigger.toLowerCase(),
    isDeveloper,
  });

  if (cooldown.status === 'silent_drop') {
    return false;
  }
  if (cooldown.status === 'cooldown' || cooldown.status === 'flood_locked') {
    const sec = (cooldown.retryAfterMs / 1000).toFixed(1);
    await msg.reply(`sleek • slow down, try again in ${sec}s`);
    return true;
  }

  // 3. guild freeze gate (L5 bypass)
  if (guildState?.isFrozen === true && !(isDeveloper && policy.developer.bypassDisabledChecks)) {
    await msg.reply('Guild is under platform safety freeze. Contact Sleek Support.');
    return true;
  }

  // 4. 4-tier alias precedence & macro expansion
  const userAliases = await deps.governance.getUserAliases(msg.platform, msg.actorId);
  const resolution = resolveCommandPrecedence({
    rawTrigger,
    guildAliases: guildState?.guildAliases ?? {},
    userAliases,
    registeredCommands: deps.commandRegistry.listNames(),
  });

  const expandedSteps: readonly string[] =
    resolution !== undefined &&
    (resolution.kind === 'guild_alias' ||
      resolution.kind === 'user_alias' ||
      resolution.kind === 'builtin_shortcut')
      ? expandAliasInvocation(resolution.expandedTemplate, rawTail, policy.aliases.maxMacroSteps)
      : [withoutPrefix];

  for (const stepLine of expandedSteps) {
    const matched = matchCommandDefinition(deps.commandRegistry, stepLine);
    if (matched === undefined) {
      continue;
    }

    const {def, rawArgs} = matched;

    // 5. disabled command/module gate (L5 bypass)
    if (
      msg.guildId !== undefined &&
      guildState !== undefined &&
      !(isDeveloper && policy.developer.bypassDisabledChecks)
    ) {
      const disabled = deps.governance.isCommandDisabledInContext({
        state: guildState,
        commandName: def.name,
        moduleId: def.moduleId,
        channelId: msg.channelId,
        actorId: msg.actorId,
        actorRoleIds: msg.actorRoleIds,
      });
      if (disabled) {
        return true;
      }
    }

    // 6. two-zone flag & duration parser
    const parsed = parseCommandArgs(rawArgs, {
      adaptiveModeration: def.adaptiveModeration,
      acceptsDuration: def.acceptsDuration,
    });

    // 7. 12-stage permission kernel
    const decision = await deps.security.authorize({
      platform: msg.platform,
      guildId: msg.guildId,
      channelId: msg.channelId,
      isDm: msg.guildId === undefined,
      moduleEnabled: true,
      commandNode: def.permissionNode,
      actorId: msg.actorId,
      guildOwnerId: msg.guildOwnerId,
      actorRoleIds: msg.actorRoleIds,
      requestedDurationMs: parsed.durationMs,
      requestedCount: parsed.threshold,
    });

    if (!decision.allowed) {
      if (resolution?.kind === 'user_alias' && decision.actorLevel === AuthorityLevel.Member) {
        return true;
      }
      await msg.reply(`Permission denied: ${decision.reason}`);
      return true;
    }

    // 8. l1-l4 velocity tripwire & CAS epoch check for state-changing commands
    if (def.mutatesState && msg.guildId !== undefined) {
      const velocity = await deps.security.recordStateChangeAndCheckVelocity({
        platform: msg.platform,
        guildId: msg.guildId,
        actorId: msg.actorId,
        actorLevel: decision.actorLevel,
        actionType: def.name,
        targetId: parsed.targets[0],
      });
      if (velocity.tripped) {
        await msg.reply(velocity.reason ?? 'Velocity tripwire tripped.');
        return true;
      }

      if (decision.epoch !== undefined) {
        const unchanged = await deps.security.assertEpochUnchanged(
          msg.platform,
          msg.guildId,
          decision.epoch,
        );
        if (!unchanged) {
          await msg.reply('Permissions changed during execution; command aborted.');
          return true;
        }
      }
    }

    // 9. execute
    await def.execute({
      platform: msg.platform,
      guildId: msg.guildId,
      channelId: msg.channelId,
      actorId: msg.actorId,
      actorRoleIds: msg.actorRoleIds,
      guildOwnerId: msg.guildOwnerId,
      rawArgs,
      parsed,
      isSudo: false,
      reply: msg.reply,
    });
  }

  return true;
}
