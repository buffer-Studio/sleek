import type {PlatformId} from '../../../base/common/platformId';
import type {
  CommandInvocationContext,
  CommandRegistry,
} from '../../../core/commands/commandRegistry';
import {parseCommandArgs} from '../../../core/parser/commandParser';
import type {MessagingPort} from '../../../core/ports/messaging.port';
import type {RolePort} from '../../../core/ports/role.port';
import type {ValkeyClient} from '../../../platform/cache/valkeyClient';
import type {SleekConfigStore} from '../../../platform/config/sleekConfig';
import type {DatabaseClient} from '../../../platform/database/drizzleClient';
import type {GovernanceService} from '../../governance/governance.contract';
import type {SecurityService} from '../../security/security.contract';

export interface DeveloperDeps {
  readonly security: SecurityService;
  readonly governance: GovernanceService;
  readonly database: DatabaseClient | undefined;
  readonly valkey: ValkeyClient;
  readonly configStore: SleekConfigStore;
  readonly rolePort: RolePort;
  readonly messagingPort: MessagingPort;
  readonly registry: CommandRegistry;
}

export function parseUserId(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const m = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(raw.trim());
  return m?.[1] ?? m?.[2];
}

function isSnowflake(raw: string | undefined): raw is string {
  return raw !== undefined && /^\d{17,20}$/.test(raw);
}

async function emitModlogAudit(
  deps: DeveloperDeps,
  platform: PlatformId,
  guildId: string,
  content: string,
): Promise<void> {
  const govState = await deps.governance.getGuildState(platform, guildId);
  if (govState.modlogChannelId !== undefined) {
    await deps.messagingPort.sendMessage({
      platform,
      channelId: govState.modlogChannelId,
      content,
    });
  }
}

export async function handleSudo(
  deps: DeveloperDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
  const trimmed = ctx.rawArgs.trim();
  if (trimmed.length === 0) {
    await ctx.reply('Usage: `,sudo [guild_id] <command...>`');
    return;
  }

  const firstSpace = trimmed.search(/\s/);
  const firstToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  let targetGuildId = ctx.guildId;
  let commandLine = trimmed;

  if (isSnowflake(firstToken) && firstSpace !== -1 && deps.registry.get(firstToken) === undefined) {
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
  const cmdDef = deps.registry.get(twoWord) ?? deps.registry.get(oneWord);

  if (cmdDef === undefined) {
    await ctx.reply(`Unknown command in sudo invocation: \`${oneWord}\`.`);
    return;
  }

  const usedWords = deps.registry.get(twoWord) !== undefined ? 2 : 1;
  const rawSubArgs = cmdTokens.slice(usedWords).join(' ');
  const parsed = parseCommandArgs(rawSubArgs, {
    adaptiveModeration: cmdDef.adaptiveModeration,
    acceptsDuration: cmdDef.acceptsDuration,
  });

  await deps.security.store.insertPlatformAuditLog({
    platform: ctx.platform,
    executorId: ctx.actorId,
    targetGuildId,
    commandExecuted: `,sudo ${commandLine}`,
    reason: parsed.reason ?? 'Level 5 Platform Override',
    payload: {command: cmdDef.name},
  });
  await emitModlogAudit(
    deps,
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

export async function handleFreeze(
  deps: DeveloperDeps,
  ctx: CommandInvocationContext,
  frozen: boolean,
): Promise<void> {
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

  await deps.governance.store.setGuildFrozen({
    platform: ctx.platform,
    guildId: targetGuildId,
    frozen,
    reason: frozen ? reason : undefined,
  });
  await deps.governance.invalidateGuild(ctx.platform, targetGuildId);
  await deps.security.store.insertPlatformAuditLog({
    platform: ctx.platform,
    executorId: ctx.actorId,
    targetGuildId,
    commandExecuted: frozen ? ',freeze' : ',unfreeze',
    reason,
    payload: {frozen},
  });
  await emitModlogAudit(
    deps,
    ctx.platform,
    targetGuildId,
    `[Platform Emergency Action] Guild ${frozen ? 'frozen' : 'unfrozen'} by <@${ctx.actorId}>: ${reason}`,
  );

  await ctx.reply(`Guild \`${targetGuildId}\` is now ${frozen ? 'frozen' : 'unfrozen'}.`);
}

export async function handleUncompromise(
  deps: DeveloperDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
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
    deps.security.store.listStaffRoles(ctx.platform, targetGuildId, 'staff'),
    deps.security.store.listStaffRoles(ctx.platform, targetGuildId, 'admin'),
  ]);
  const allBoundRoles = [...new Set([...staffRoles, ...adminRoles])];
  if (allBoundRoles.length > 0) {
    await deps.rolePort.removeMemberRoles({
      platform: ctx.platform,
      guildId: targetGuildId,
      userId: targetUserId,
      roleIds: allBoundRoles,
      reason,
    });
  }

  const dbRes = await deps.security.store.uncompromiseMember({
    platform: ctx.platform,
    guildId: targetGuildId,
    targetUserId,
  });
  await deps.security.invalidateGuildCache(ctx.platform, targetGuildId);
  await deps.security.store.insertPlatformAuditLog({
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
    deps,
    ctx.platform,
    targetGuildId,
    `[Platform Emergency Action] Uncompromised <@${targetUserId}> (actingOwnerRevoked=${String(dbRes.actingOwnerRevoked)}, roles=${allBoundRoles.length}): ${reason}`,
  );

  await ctx.reply(
    `Uncompromised <@${targetUserId}> in \`${targetGuildId}\` (ActingOwner revoked: ${String(dbRes.actingOwnerRevoked)}, bound roles stripped: ${allBoundRoles.length}).`,
  );
}
