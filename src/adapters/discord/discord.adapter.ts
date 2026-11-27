import type {StructuredLogger} from '../../platform/logger/structuredLogger';

export interface BotHandle {
  stop: () => void;
}

export interface VerifyDiscordBotOptions {
  readonly token: string;
  readonly logger: StructuredLogger;
  readonly fetchFn?: typeof fetch;
}

export async function verifyDiscordGateway(options: VerifyDiscordBotOptions): Promise<void> {
  const fetchImpl = options.fetchFn ?? fetch;
  const gatewayRes = await fetchImpl('https://discord.com/api/v10/gateway/bot', {
    headers: {
      Authorization: `Bot ${options.token}`,
    },
  });

  if (!gatewayRes.ok) {
    const body = await gatewayRes.text();
    throw new Error(`Failed to fetch Discord gateway URL (${gatewayRes.status}): ${body}`);
  }

  options.logger.info('discord.gateway.verified');
}
