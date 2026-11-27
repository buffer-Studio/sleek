import {describe, expect, it} from 'bun:test';

import {AuthorityLevel} from '../../core/auth/authorityLevel';
import {CommandRegistry} from '../../core/commands/commandRegistry';
import {createEventBus} from '../../core/events/eventBus';
import {createGuildHierarchyCache} from '../../core/hierarchy/guildHierarchyCache';
import {createFakeInteractionPort} from '../../core/ports/testing/fakeInteraction.port';
import type {SecurityService} from '../../modules/security/security.contract';
import {dispatchInteraction} from './interactionDispatcher';

function createStubSecurity(allowed: boolean): SecurityService {
  return {
    isBotOwner: () => false,
    resolveActorLevel: () => Promise.resolve(AuthorityLevel.Member),
    authorize: () =>
      Promise.resolve({
        allowed,
        stage: 1,
        reason: allowed ? 'allowed' : 'missing permission',
        actorLevel: AuthorityLevel.Member,
        epoch: undefined,
        durationCeilingMs: undefined,
        quantityCeiling: undefined,
        trace: [],
      }),
    recordStateChangeAndCheckVelocity: () => Promise.resolve({tripped: false}),
    assertEpochUnchanged: () => Promise.resolve(true),
    flushAllCaches: () => undefined,
    registerCommands: () => undefined,
  } as unknown as SecurityService;
}

describe('interactionDispatcher', () => {
  it('routes slash command interactions through PermissionKernel and InteractionPort', async () => {
    const registry = new CommandRegistry();
    let executed = false;
    registry.register({
      name: 'ping',
      moduleId: 'core',
      description: 'Ping',
      permissionNode: 'antinuke.list',
      mutatesState: false,
      adaptiveModeration: false,
      acceptsDuration: false,
      execute: async ctx => {
        executed = true;
        await ctx.reply('pong!');
      },
    });

    const eventBus = createEventBus();
    const hierarchyCache = createGuildHierarchyCache({eventBus});
    const interactionPort = createFakeInteractionPort();

    const handled = await dispatchInteraction(
      {
        commandRegistry: registry,
        security: createStubSecurity(true),
        interactionPort,
        hierarchyCache,
      },
      'discord',
      {
        id: 'int-1',
        token: 'tok-1',
        type: 2,
        guild_id: 'g-1',
        channel_id: 'c-1',
        member: {user: {id: 'u-1'}, roles: []},
        data: {name: 'ping'},
      },
    );

    expect(handled).toBe(true);
    expect(executed).toBe(true);
    expect(interactionPort.replies.length).toBe(1);
    expect(interactionPort.replies[0]?.content).toBe('pong!');
    hierarchyCache.dispose();
  });

  it('routes Discord subcommand interactions such as /honeypot setup', async () => {
    const registry = new CommandRegistry();
    let capturedChannelArg: string | undefined;
    registry.register({
      name: 'honeypot setup',
      moduleId: 'honeypot',
      description: 'Setup honeypot',
      permissionNode: 'server.honeypot.manage',
      mutatesState: true,
      execute: async ctx => {
        capturedChannelArg = ctx.parsed.targets[0];
        await ctx.reply('setup started');
      },
    });

    const eventBus = createEventBus();
    const hierarchyCache = createGuildHierarchyCache({eventBus});
    const interactionPort = createFakeInteractionPort();

    const handled = await dispatchInteraction(
      {
        commandRegistry: registry,
        security: createStubSecurity(true),
        interactionPort,
        hierarchyCache,
      },
      'discord',
      {
        id: 'int-2',
        token: 'tok-2',
        type: 2,
        guild_id: 'g-1',
        channel_id: 'c-1',
        member: {user: {id: 'u-1'}, roles: []},
        data: {
          name: 'honeypot',
          options: [
            {
              type: 1,
              name: 'setup',
              options: [{name: 'channel', type: 7, value: '333333333333333333'}],
            },
          ],
        },
      },
    );

    expect(handled).toBe(true);
    expect(capturedChannelArg).toBe('333333333333333333');
    expect(interactionPort.replies[0]?.content).toBe('setup started');
    hierarchyCache.dispose();
  });

  it('replies ephemerally when PermissionKernel denies an interaction command', async () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'ban',
      moduleId: 'security',
      description: 'Ban',
      permissionNode: 'antinuke.module.ban',
      mutatesState: true,
      adaptiveModeration: false,
      acceptsDuration: false,
      execute: async () => {
        await Promise.resolve();
      },
    });

    const eventBus = createEventBus();
    const hierarchyCache = createGuildHierarchyCache({eventBus});
    const interactionPort = createFakeInteractionPort();

    await dispatchInteraction(
      {
        commandRegistry: registry,
        security: createStubSecurity(false),
        interactionPort,
        hierarchyCache,
      },
      'discord',
      {
        id: 'int-2',
        token: 'tok-2',
        type: 2,
        guild_id: 'g-1',
        channel_id: 'c-1',
        member: {user: {id: 'u-2'}, roles: []},
        data: {name: 'ban'},
      },
    );

    expect(interactionPort.replies.length).toBe(1);
    expect(interactionPort.replies[0]?.ephemeral).toBe(true);
    expect(interactionPort.replies[0]?.content).toContain('Permission denied');
    hierarchyCache.dispose();
  });
});
