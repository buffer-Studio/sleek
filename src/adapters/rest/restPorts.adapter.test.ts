import {describe, expect, it} from 'bun:test';

import {createRestClient} from './restClient';
import {createRestPorts} from './restPorts.adapter';

function makeSnowflakeAtMs(tsMs: number): string {
  const discordEpoch = 1_420_070_400_000n;
  const offset = BigInt(tsMs) - discordEpoch;
  return (offset << 22n).toString();
}

describe('restPorts.adapter', () => {
  it('partitions bulkDeleteMessages by 14-day snowflake age and routes single recent ID to DELETE', async () => {
    const requests: Array<{method: string; url: string}> = [];
    const nowMs = 1_750_000_000_000;
    const oldId = makeSnowflakeAtMs(nowMs - 20 * 86_400_000);
    const recentId = makeSnowflakeAtMs(nowMs - 1_000);

    const restClient = createRestClient({
      discordToken: 'test-token',
      fluxerApiBaseUrl: 'https://api.fluxer.app/v1',
      fetchFn: (input, init) => {
        requests.push({
          method: init?.method ?? 'GET',
          url:
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        });
        return Promise.resolve(new Response(null, {status: 204}));
      },
    });

    const {moderationPort} = createRestPorts({
      restClient,
      nowMs: () => nowMs,
    });

    const res = await moderationPort.bulkDeleteMessages({
      platform: 'discord',
      channelId: '555',
      messageIds: [oldId, recentId],
      reason: 'cleanup',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.deletedCount).toBe(1);
      expect(res.value.skippedOldIds).toEqual([oldId]);
    }
    expect(requests.length).toBe(1);
    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toContain(`/channels/555/messages/${recentId}`);
    restClient.dispose();
  });

  it('fails fast with unsupported_platform on Fluxer InteractionPort calls without issuing fetch', async () => {
    let fetchCount = 0;
    const restClient = createRestClient({
      discordToken: 'test-token',
      fluxerToken: 'fluxer-token',
      fluxerApiBaseUrl: 'https://api.fluxer.app/v1',
      fetchFn: () => {
        fetchCount += 1;
        return Promise.resolve(new Response(null, {status: 204}));
      },
    });

    const {interactionPort} = createRestPorts({restClient});
    const res = await interactionPort.replyInteraction({
      platform: 'fluxer',
      interactionId: '1',
      interactionToken: 'tok',
      content: 'hello',
      ephemeral: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('unsupported_platform');
    }
    expect(fetchCount).toBe(0);
    restClient.dispose();
  });
});
