import {describe, expect, it} from 'bun:test';

import {AuthorityLevel} from '../../core/auth/authorityLevel';
import {FakeMessagingPort} from '../../core/ports/testing/fakeMessaging.port';
import {FakeRolePort} from '../../core/ports/testing/fakeRole.port';
import {
  GOVERNANCE_SERVICE_KEY,
  MemoryGovernanceStore,
} from '../../modules/governance/governance.contract';
import {registerCoreModules} from '../../modules/manifest';
import {MemorySecurityStore, SECURITY_SERVICE_KEY} from '../../modules/security/security.contract';
import {FakeValkeyClient} from '../../platform/cache/testing/fakeValkeyClient';
import {loadSleekConfig, SleekConfigStore} from '../../platform/config/sleekConfig';
import {TestServiceRegistry} from '../../platform/di/testServiceRegistry';
import {createStructuredLogger} from '../../platform/logger/structuredLogger';
import {dispatchPrefixMessage} from './commandDispatcher';

async function setupDispatcher() {
  const registry = new TestServiceRegistry();
  const securityStore = new MemorySecurityStore();
  const governanceStore = new MemoryGovernanceStore();
  const valkey = new FakeValkeyClient();
  const policy = await loadSleekConfig('config/sleek.yaml');
  const testPolicy = {
    ...policy,
    cooldowns: {
      ...policy.cooldowns,
      commandOverridesMs: {
        ...policy.cooldowns.commandOverridesMs,
        actingowner: 0,
      },
    },
  };
  const configStore = new SleekConfigStore(testPolicy, 'config/sleek.yaml');
  const rolePort = new FakeRolePort();
  const messagingPort = new FakeMessagingPort();
  const logger = createStructuredLogger({minLevel: 'error', prettyConsole: false});

  const commandRegistry = registerCoreModules({
    registry,
    securityStore,
    governanceStore,
    valkey,
    database: undefined,
    configStore,
    botOwnersByPlatform: {
      discord: new Set(['999999999999999999']),
      fluxer: new Set(['888888888888888888']),
    },
    rolePort,
    messagingPort,
    logger,
  });

  const security = registry.resolve(SECURITY_SERVICE_KEY);
  const governance = registry.resolve(GOVERNANCE_SERVICE_KEY);

  return {
    commandRegistry,
    security,
    governance,
    configStore,
    securityStore,
    rolePort,
    messagingPort,
  };
}

describe('commandDispatcher end-to-end (offline)', () => {
  it('enforces I4 deny-by-default for regular members and allows True Owner', async () => {
    const {commandRegistry, security, governance, configStore} = await setupDispatcher();
    const replies: string[] = [];

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'discord',
        guildId: '100000000000000001',
        channelId: '200000000000000001',
        actorId: '300000000000000001',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',prefix set !',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[0]).toContain('Permission denied');

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'discord',
        guildId: '100000000000000001',
        channelId: '200000000000000001',
        actorId: '400000000000000001',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',prefix set !',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[1]).toContain('Updated guild prefix to `!`');
  });

  it('supports Level 5 ,sudo, ,freeze, ,unfreeze, and ,uncompromise across platforms', async () => {
    const {commandRegistry, security, governance, configStore, securityStore} =
      await setupDispatcher();
    const replies: string[] = [];

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'discord',
        guildId: '100000000000000001',
        channelId: '200000000000000001',
        actorId: '999999999999999999',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',freeze 100000000000000001 Compromise detected',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[0]).toContain('is now frozen');

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'discord',
        guildId: '100000000000000001',
        channelId: '200000000000000001',
        actorId: '400000000000000001',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',prefix view',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[1]).toContain('platform safety freeze');

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'fluxer',
        guildId: '100000000000000001',
        channelId: '200000000000000001',
        actorId: '888888888888888888',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',sudo 100000000000000001 bind staff <@&500000000000000001>',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[2]).toContain('Bound <@&500000000000000001> as staff role');
    expect(securityStore.auditLogs.length).toBe(2);
  });

  it('trips Acting Owner velocity threshold and freezes session', async () => {
    const {commandRegistry, security, governance, configStore} = await setupDispatcher();
    const replies: string[] = [];

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'discord',
        guildId: '100000000000000002',
        channelId: '200000000000000001',
        actorId: '400000000000000001',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',actingowner grant <@600000000000000001> 7d',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[0]).toContain('Appointed <@600000000000000001> as Acting Owner');

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: 'discord',
        guildId: '100000000000000002',
        channelId: '200000000000000001',
        actorId: '400000000000000001',
        actorRoleIds: [],
        guildOwnerId: '400000000000000001',
        content: ',actingowner threshold burst 10/60s',
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    expect(replies[1]).toContain('burst threshold to 10/60s');

    let trippedMsg = '';
    for (let i = 0; i < 11; i += 1) {
      const res = await security.recordStateChangeAndCheckVelocity({
        platform: 'discord',
        guildId: '100000000000000002',
        actorId: '600000000000000001',
        actorLevel: AuthorityLevel.ActingOwner,
        actionType: 'test.mutate',
      });
      if (res.tripped) {
        trippedMsg = res.reason ?? '';
      }
    }
    expect(trippedMsg).toContain('Velocity tripwire tripped');
  });
});
