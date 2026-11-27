import {describe, expect, it} from 'bun:test';

import {RateLimitBucketStore} from './rateLimitBucketStore';
import {createRestClient} from './restClient';

describe('restClient', () => {
  it('retries 429 responses using X-RateLimit-Reset-After and succeeds', async () => {
    let calls = 0;
    let now = 1000;
    const slept: number[] = [];
    const sleepMs = async (ms: number): Promise<void> => {
      await Promise.resolve();
      slept.push(ms);
      now += ms;
    };
    const bucketStore = new RateLimitBucketStore({
      nowMs: () => now,
      sleepMs,
    });
    const client = createRestClient({
      discordToken: 'test-token',
      fluxerApiBaseUrl: 'https://api.fluxer.app/v1',
      bucketStore,
      sleepMs,
      fetchFn: async () => {
        await Promise.resolve();
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({message: 'rate limited', retry_after: 0.25}), {
            status: 429,
            headers: {
              'x-ratelimit-reset-after': '0.25',
              'x-ratelimit-bucket': 'ban-bucket',
              'x-ratelimit-remaining': '0',
            },
          });
        }
        return new Response(null, {status: 204});
      },
    });

    const result = await client.request<undefined>({
      platform: 'discord',
      method: 'PUT',
      path: '/guilds/1/bans/2',
      routeKey: 'guilds/:guildId/bans/:userId',
      majorParam: '1',
      auditLogReason: 'honeypot trigger',
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(slept).toEqual([250]);
    client.dispose();
  });

  it('exempts interactions/* routes from global pause while pausing regular routes', async () => {
    const slept: number[] = [];
    let now = 1000;
    const bucketStore = new RateLimitBucketStore({
      nowMs: () => now,
      sleepMs: ms => {
        slept.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    bucketStore.notifyGlobalPause('discord', 500);

    const client = createRestClient({
      discordToken: 'test-token',
      fluxerApiBaseUrl: 'https://api.fluxer.app/v1',
      bucketStore,
      sleepMs: ms => {
        slept.push(ms);
        return Promise.resolve();
      },
      fetchFn: async () => {
        await Promise.resolve();
        return new Response(null, {status: 204});
      },
    });

    const interactionRes = await client.request<undefined>({
      platform: 'discord',
      method: 'POST',
      path: '/interactions/123/tok/callback',
      routeKey: 'interactions/:id/:token/callback',
    });
    expect(interactionRes.ok).toBe(true);
    expect(slept).toEqual([]);

    const banRes = await client.request<undefined>({
      platform: 'discord',
      method: 'PUT',
      path: '/guilds/1/bans/2',
      routeKey: 'guilds/:guildId/bans/:userId',
      majorParam: '1',
    });
    expect(banRes.ok).toBe(true);
    expect(slept).toEqual([500]);
    client.dispose();
  });

  it('opens invalid-request circuit breaker for non-critical writes after threshold', async () => {
    const bucketStore = new RateLimitBucketStore({
      invalidRequestThreshold: 2,
    });
    const client = createRestClient({
      discordToken: 'test-token',
      fluxerApiBaseUrl: 'https://api.fluxer.app/v1',
      bucketStore,
      fetchFn: async () => {
        await Promise.resolve();
        return new Response(JSON.stringify({message: 'Missing Permissions', code: 50013}), {
          status: 403,
        });
      },
    });

    const r1 = await client.request<undefined>({
      platform: 'discord',
      method: 'DELETE',
      path: '/channels/1/messages/2',
      routeKey: 'channels/:channelId/messages/:messageId',
      majorParam: '1',
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('forbidden');
      expect(r1.error.apiCode).toBe(50013);
    }

    await client.request<undefined>({
      platform: 'discord',
      method: 'DELETE',
      path: '/channels/1/messages/3',
      routeKey: 'channels/:channelId/messages/:messageId',
      majorParam: '1',
    });

    const r3 = await client.request<undefined>({
      platform: 'discord',
      method: 'DELETE',
      path: '/channels/1/messages/4',
      routeKey: 'channels/:channelId/messages/:messageId',
      majorParam: '1',
    });
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.error.code).toBe('circuit_open');
    }
    client.dispose();
  });
});
