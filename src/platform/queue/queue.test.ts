import {describe, expect, it} from 'bun:test';

import {createFakeQueuePort} from './testing/fakeQueue.port';

describe('FakeQueuePort', () => {
  it('enforces dedupeKey uniqueness for pending jobs and drains due jobs', async () => {
    const queue = createFakeQueuePort();
    const executed: number[] = [];

    queue.registerHandler('unban', job => {
      executed.push(Number(job.payload.userId));
      return Promise.resolve();
    });

    const first = await queue.enqueue({
      jobType: 'unban',
      payload: {userId: 42},
      runAt: new Date(1000),
      dedupeKey: 'unban:1:42',
    });
    expect(first.ok).toBe(true);

    const dup = await queue.enqueue({
      jobType: 'unban',
      payload: {userId: 42},
      runAt: new Date(1000),
      dedupeKey: 'unban:1:42',
    });
    expect(dup.ok).toBe(false);

    const future = await queue.enqueue({
      jobType: 'unban',
      payload: {userId: 99},
      runAt: new Date(5000),
      dedupeKey: 'unban:1:99',
    });
    expect(future.ok).toBe(true);

    const count1 = await queue.drainDue(2000);
    expect(count1).toBe(1);
    expect(executed).toEqual([42]);

    const cancelled = await queue.cancelByDedupeKey('unban:1:99');
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.value).toBe(true);
    }

    const count2 = await queue.drainDue(6000);
    expect(count2).toBe(0);
    expect(executed).toEqual([42]);
  });
});
