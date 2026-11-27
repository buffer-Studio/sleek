import {describe, expect, it} from 'bun:test';

import {createEventBus} from '../events/eventBus';
import {createGuildHierarchyCache} from './guildHierarchyCache';

describe('guildHierarchyCache', () => {
  it('hydrates member roles opportunistically from MESSAGE_CREATE without REST or GUILD_MEMBERS intent', async () => {
    const eventBus = createEventBus();
    let restMemberCalls = 0;
    const cache = createGuildHierarchyCache({
      eventBus,
      fetchMemberRoles: () => {
        restMemberCalls += 1;
        return Promise.resolve({found: true, roles: []});
      },
    });

    await eventBus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'READY',
          rawJson: JSON.stringify({user: {id: 'bot-1'}, guilds: []}),
        },
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'GUILD_CREATE',
          rawJson: JSON.stringify({
            id: 'guild-1',
            owner_id: 'owner-1',
            roles: [
              {id: 'r-mod', position: 10},
              {id: 'r-bot', position: 25},
            ],
          }),
        },
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'MESSAGE_CREATE',
          rawJson: JSON.stringify({
            guild_id: 'guild-1',
            channel_id: 'ch-1',
            content: 'hello',
            author: {id: 'user-1'},
            member: {roles: ['r-mod']},
          }),
        },
      ],
    });

    const ctx = await cache.resolveHierarchyContext({
      platform: 'discord',
      guildId: 'guild-1',
      actorId: 'user-1',
    });

    expect(ctx.guildOwnerId).toBe('owner-1');
    expect(ctx.actorHighestRolePosition).toBe(10);
    // only bot-1 missed L1; user-1 was hydrated opportunistically
    expect(restMemberCalls).toBe(1);
    cache.dispose();
  });

  it('guards unavailable guilds from READY burst and deduplicates concurrent REST fallbacks', async () => {
    const eventBus = createEventBus();
    let guildRestCalls = 0;
    let memberRestCalls = 0;

    const cache = createGuildHierarchyCache({
      eventBus,
      fetchGuildMetadata: () => {
        guildRestCalls += 1;
        return Promise.resolve({ownerId: 'owner-2', roles: [{id: 'r-1', position: 5}]});
      },
      fetchMemberRoles: async () => {
        memberRestCalls += 1;
        await Promise.resolve();
        return {found: false, roles: []};
      },
    });

    await eventBus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'READY',
          rawJson: JSON.stringify({
            user: {id: 'bot-1'},
            guilds: [{id: 'guild-unavail', unavailable: true}],
          }),
        },
      ],
    });

    const unavailCtx = await cache.resolveHierarchyContext({
      platform: 'discord',
      guildId: 'guild-unavail',
      actorId: 'u-1',
    });
    expect(unavailCtx.guildOwnerId).toBeUndefined();
    expect(guildRestCalls).toBe(0);

    await eventBus.publishRawBatch({
      droppedCount: 0,
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'GUILD_CREATE',
          rawJson: JSON.stringify({
            id: 'guild-unavail',
            owner_id: 'owner-2',
            roles: [{id: 'r-1', position: 5}],
          }),
        },
      ],
    });

    // concurrent lookups for missing member should coalesce to 1 REST call and cache negative result
    await Promise.all([
      cache.resolveHierarchyContext({
        platform: 'discord',
        guildId: 'guild-unavail',
        actorId: 'u-404',
      }),
      cache.resolveHierarchyContext({
        platform: 'discord',
        guildId: 'guild-unavail',
        actorId: 'u-404',
      }),
    ]);

    expect(memberRestCalls).toBe(2); // 1 for u-404, 1 for bot-1
    cache.dispose();
  });
});
