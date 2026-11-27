import {describe, expect, it} from 'bun:test';

import {DEFAULT_EVENT_INTEREST} from '../../core/ports/gateway.port';
import {createFakeGatewayPort} from '../../core/ports/testing/fakeGateway.port';

describe('FakeGatewayPort', () => {
  it('captures start config, emits batches, and records stop timeout', () => {
    const gateway = createFakeGatewayPort();
    const received: string[] = [];

    gateway.start(
      {
        discordToken: 'discord-test',
        fluxerToken: 'fluxer-test',
        interestMask: DEFAULT_EVENT_INTEREST,
      },
      batch => {
        for (const event of batch.events) {
          received.push(`${event.platform}:${event.eventType}`);
        }
      },
    );

    gateway.emitBatch({
      events: [
        {platform: 'discord', shardId: 0, eventType: 'READY', rawJson: '{}'},
        {platform: 'fluxer', shardId: 0, eventType: 'READY', rawJson: '{}'},
      ],
      droppedCount: 0,
    });
    gateway.setEventInterest(DEFAULT_EVENT_INTEREST);
    gateway.stop(5000);

    expect(gateway.startedConfigs).toHaveLength(1);
    expect(received).toEqual(['discord:READY', 'fluxer:READY']);
    expect(gateway.interestHistory).toEqual([DEFAULT_EVENT_INTEREST]);
    expect(gateway.stopCalls).toEqual([5000]);
  });
});
