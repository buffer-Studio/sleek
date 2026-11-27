import {z} from 'zod';

import type {StructuredLogger} from '../../platform/logger/structuredLogger';

export interface ResolveFluxerGatewayOptions {
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly logger: StructuredLogger;
  readonly fetchFn?: typeof fetch;
}

const fluxerGatewaySchema = z.object({
  url: z.string(),
});

export async function resolveFluxerGatewayUrl(
  options: ResolveFluxerGatewayOptions,
): Promise<string> {
  const fetchImpl = options.fetchFn ?? fetch;
  const baseUrl = options.apiBaseUrl.replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}/users/@me`, {
    headers: {
      Authorization: `Bot ${options.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fluxer authentication failed (${response.status}): ${body}`);
  }

  let wsUrl = 'wss://gateway.fluxer.com/?v=1&encoding=json';
  const gwRes = await fetchImpl(`${baseUrl}/gateway/bot`, {
    headers: {
      Authorization: `Bot ${options.token}`,
    },
  });
  if (gwRes.ok) {
    const parsedGw = fluxerGatewaySchema.safeParse(await gwRes.json());
    if (parsedGw.success) {
      wsUrl = `${parsedGw.data.url}/?v=1&encoding=json`;
    }
  }

  options.logger.info('fluxer.gateway.verified', {wsUrl});
  return wsUrl;
}
