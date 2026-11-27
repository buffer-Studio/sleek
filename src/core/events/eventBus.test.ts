import {describe, expect, it} from 'bun:test';

import {createEventBus} from './eventBus';

describe('eventBus', () => {
  it('skips parsing unsubscribed event types', async () => {
    const bus = createEventBus();
    // invalid JSON should not throw when there are zero subscribers
    await bus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'MESSAGE_CREATE',
          rawJson: '{invalid-json',
        },
      ],
    });
    expect(true).toBe(true);
  });

  it('runs projection subscribers synchronously before async subscribers in the same batch', async () => {
    const bus = createEventBus();
    const order: string[] = [];

    bus.subscribeProjection('GUILD_CREATE', event => {
      order.push(`projection:${event.data.id}`);
    });
    bus.subscribe('MESSAGE_CREATE', async event => {
      await Promise.resolve();
      order.push(`async:${event.data.guild_id ?? 'dm'}`);
    });

    await bus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'GUILD_CREATE',
          rawJson: JSON.stringify({id: '100', owner_id: '1', roles: []}),
        },
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'MESSAGE_CREATE',
          rawJson: JSON.stringify({
            guild_id: '100',
            channel_id: '200',
            content: 'hi',
            author: {id: '300'},
          }),
        },
      ],
    });

    expect(order).toEqual(['projection:100', 'async:100']);
  });

  it('isolates subscriber errors and supports Disposable unsubscribe', async () => {
    const bus = createEventBus();
    const received: string[] = [];

    const sub1 = bus.subscribe('MESSAGE_CREATE', () => {
      throw new Error('boom');
    });
    const sub2 = bus.subscribe('MESSAGE_CREATE', event => {
      received.push(event.data.content);
    });

    await bus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'MESSAGE_CREATE',
          rawJson: JSON.stringify({
            channel_id: '1',
            content: 'first',
            author: {id: '2'},
          }),
        },
      ],
    });
    expect(received).toEqual(['first']);

    sub1.dispose();
    sub2.dispose();

    await bus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'MESSAGE_CREATE',
          rawJson: JSON.stringify({
            channel_id: '1',
            content: 'second',
            author: {id: '2'},
          }),
        },
      ],
    });
    expect(received).toEqual(['first']);
  });
});
