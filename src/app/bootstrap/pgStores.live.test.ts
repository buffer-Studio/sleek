import {describe, expect, it} from 'bun:test';

import {createPgGovernanceStore} from '../../modules/governance/governance.contract';
import {createPgSecurityStore} from '../../modules/security/security.contract';
import {createValkeyClient} from '../../platform/cache/valkeyClient';
import {parseEnv} from '../../platform/config/envSchema';
import {createDrizzleClient} from '../../platform/database/drizzleClient';

const runLive = process.env.RUN_LIVE_INFRA_TESTS === '1';

describe.skipIf(!runLive)('live PostgreSQL 17 & Valkey 8 integration', () => {
  it('persists security and governance state with composite (platform, guild_id) keys', async () => {
    const env = parseEnv();
    const db = createDrizzleClient({
      databaseUrl: env.DATABASE_URL,
      poolMax: 2,
      prepare: false,
    });
    const valkey = await createValkeyClient(env.VALKEY_URL);

    try {
      expect(await db.healthCheck()).toBe(true);
      expect(await valkey.healthCheck()).toBe(true);

      const secStore = createPgSecurityStore(db);
      const govStore = createPgGovernanceStore(db);

      const testGuild = '999000000000000001';
      await secStore.toggleStaffRole({
        platform: 'discord',
        guildId: testGuild,
        roleId: '888000000000000001',
        tier: 'staff',
        actorId: '777000000000000001',
      });
      const snapshot = await secStore.getGuildSecuritySnapshot('discord', testGuild);
      expect(snapshot.boundStaffRoleIds.has('888000000000000001')).toBe(true);

      await govStore.setGuildPrefix({
        platform: 'fluxer',
        guildId: testGuild,
        prefix: '!',
        fallbackCommaDisabled: true,
      });
      const govState = await govStore.getGuildGovernanceState('fluxer', testGuild);
      expect(govState.prefix).toBe('!');
      expect(govState.fallbackCommaDisabled).toBe(true);

      const sqlResult = await db.executeReadOnlySql('SELECT 1 AS ok', 3000, 10);
      expect(sqlResult.rows.length).toBe(1);
    } finally {
      await valkey.disposeAsync();
      await db.disposeAsync();
    }
  });
});
