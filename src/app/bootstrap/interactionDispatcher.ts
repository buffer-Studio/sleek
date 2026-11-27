import {z} from 'zod';

import type {PlatformId} from '../../base/common/platformId';
import type {CommandRegistry} from '../../core/commands/commandRegistry';
import type {InteractionCreateEventData} from '../../core/events/gatewayEvents';
import type {GuildHierarchyCache} from '../../core/hierarchy/guildHierarchyCache';
import {parseCommandArgs} from '../../core/parser/commandParser';
import type {InteractionPort} from '../../core/ports/interaction.port';
import type {SecurityService} from '../../modules/security/security.contract';

export type ComponentInteractionHandler = (ctx: {
  readonly platform: PlatformId;
  readonly guildId: string | undefined;
  readonly channelId: string | undefined;
  readonly actorId: string;
  readonly actorRoleIds: readonly string[];
  readonly customId: string;
  readonly reply: (content: string, ephemeral?: boolean) => Promise<void>;
}) => Promise<void>;

export interface InteractionDispatcherDeps {
  readonly commandRegistry: CommandRegistry;
  readonly security: SecurityService;
  readonly interactionPort: InteractionPort;
  readonly hierarchyCache: GuildHierarchyCache;
  readonly componentHandlers?: ReadonlyMap<string, ComponentInteractionHandler>;
}

const interactionOptionSchema = z.object({
  name: z.string().optional(),
  type: z.number().int().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.unknown()).optional(),
});

function resolveSlashCommandAndArgs(
  rootName: string,
  options: readonly unknown[] | undefined,
): {readonly commandName: string; readonly rawArgs: string} {
  if (options === undefined || options.length === 0) {
    return {commandName: rootName, rawArgs: ''};
  }

  const first = interactionOptionSchema.safeParse(options[0]);
  if (first.success && first.data.type === 1 && first.data.name !== undefined) {
    return {
      commandName: `${rootName} ${first.data.name.toLowerCase()}`,
      rawArgs: extractOptionArgs(first.data.options),
    };
  }

  return {
    commandName: rootName,
    rawArgs: extractOptionArgs(options),
  };
}

function extractOptionArgs(options: readonly unknown[] | undefined): string {
  if (options === undefined || options.length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (const opt of options) {
    const parsed = interactionOptionSchema.safeParse(opt);
    if (parsed.success && parsed.data.value !== undefined) {
      parts.push(String(parsed.data.value));
    }
  }
  return parts.join(' ');
}

export async function dispatchInteraction(
  deps: InteractionDispatcherDeps,
  platform: PlatformId,
  data: InteractionCreateEventData,
): Promise<boolean> {
  const actorId = data.member?.user?.id ?? data.user?.id;
  if (actorId === undefined) {
    return false;
  }

  const actorRoleIds = data.member?.roles ?? [];
  const reply = async (content: string, ephemeral = true): Promise<void> => {
    await deps.interactionPort.replyInteraction({
      platform,
      interactionId: data.id,
      interactionToken: data.token,
      content,
      ephemeral,
    });
  };

  // application command (type === 2)
  if (data.type === 2) {
    const rootName = data.data?.name?.toLowerCase();
    if (rootName === undefined) {
      return false;
    }
    const {commandName, rawArgs} = resolveSlashCommandAndArgs(rootName, data.data?.options);
    const def = deps.commandRegistry.get(commandName);
    if (def === undefined) {
      await reply(`Unknown command: ${commandName}`, true);
      return true;
    }

    const hierarchy =
      data.guild_id !== undefined
        ? await deps.hierarchyCache.resolveHierarchyContext({
            platform,
            guildId: data.guild_id,
            actorId,
          })
        : undefined;

    const parsed = parseCommandArgs(rawArgs, {
      adaptiveModeration: def.adaptiveModeration,
      acceptsDuration: def.acceptsDuration,
    });

    const decision = await deps.security.authorize({
      platform,
      guildId: data.guild_id,
      channelId: data.channel_id ?? '',
      isDm: data.guild_id === undefined,
      moduleEnabled: true,
      commandNode: def.permissionNode,
      actorId,
      guildOwnerId: hierarchy?.guildOwnerId,
      actorRoleIds,
      requestedDurationMs: parsed.durationMs,
      requestedCount: parsed.threshold,
    });

    if (!decision.allowed) {
      await reply(`Permission denied: ${decision.reason}`, true);
      return true;
    }

    await def.execute({
      platform,
      guildId: data.guild_id,
      channelId: data.channel_id ?? '',
      actorId,
      actorRoleIds,
      guildOwnerId: hierarchy?.guildOwnerId,
      rawArgs,
      parsed,
      isSudo: false,
      reply: async content => {
        await reply(content, false);
      },
    });
    return true;
  }

  // message component (type === 3) or modal submit (type === 5)
  if (data.type === 3 || data.type === 5) {
    const customId = data.data?.custom_id;
    if (customId === undefined) {
      return false;
    }
    const prefix = customId.split(':')[0] ?? customId;
    const handler = deps.componentHandlers?.get(customId) ?? deps.componentHandlers?.get(prefix);
    if (handler === undefined) {
      return false;
    }
    await handler({
      platform,
      guildId: data.guild_id,
      channelId: data.channel_id,
      actorId,
      actorRoleIds,
      customId,
      reply,
    });
    return true;
  }

  return false;
}
