import type {StructuredLogger} from '../../platform/logger/structuredLogger';

export interface DiscordSlashCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly default_member_permissions?: string;
  readonly options?: readonly unknown[];
}

export interface SyncDiscordSlashCommandsOptions {
  readonly token: string;
  readonly applicationId: string;
  readonly guildId?: string;
  readonly commands: readonly DiscordSlashCommandDefinition[];
  readonly logger: StructuredLogger;
  readonly fetchFn?: typeof fetch;
}

export async function syncDiscordSlashCommands(
  options: SyncDiscordSlashCommandsOptions,
): Promise<void> {
  const fetchImpl = options.fetchFn ?? fetch;
  const url =
    options.guildId !== undefined
      ? `https://discord.com/api/v10/applications/${options.applicationId}/guilds/${options.guildId}/commands`
      : `https://discord.com/api/v10/applications/${options.applicationId}/commands`;

  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.commands),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord slash command sync failed (${response.status}): ${body}`);
  }

  options.logger.info('discord.slash_commands.synced', {
    scope: options.guildId ?? 'global',
    guildId: options.guildId,
    count: options.commands.length,
  });
}
