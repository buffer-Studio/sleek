import {describe, expect, it} from 'bun:test';

import {parseEnv} from './envSchema';

describe('parseEnv', () => {
  it('applies defaults when optional env vars are omitted', () => {
    const config = parseEnv({});

    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SLEEK_RUNTIME_MODE).toBe('allInOne');
    expect(config.FLUXER_API_BASE_URL).toBe('https://api.fluxer.app/v1');
    expect(config.botOwnersByPlatform.discord.size).toBe(0);
    expect(config.botOwnersByPlatform.fluxer.size).toBe(0);
    expect(config.enableDevSlashSync).toBe(false);
  });

  it('parses platform-qualified owner snowflakes and dev guild IDs', () => {
    const config = parseEnv({
      DISCORD_BOT_OWNER_IDS: '123456789012345678, 223456789012345678',
      FLUXER_BOT_OWNER_IDS: '987654321098765432',
      DISCORD_DEV_GUILD_ID: '111111111111111111',
      ENABLE_DEV_SLASH_SYNC: 'true',
    });

    expect(config.botOwnersByPlatform.discord.has('123456789012345678')).toBe(true);
    expect(config.botOwnersByPlatform.discord.has('223456789012345678')).toBe(true);
    expect(config.botOwnersByPlatform.fluxer.has('987654321098765432')).toBe(true);
    expect(config.botOwnersByPlatform.fluxer.has('123456789012345678')).toBe(false);
    expect(config.devGuildIdsByPlatform.discord).toBe('111111111111111111');
    expect(config.enableDevSlashSync).toBe(true);
  });

  it('rejects malformed snowflake IDs', () => {
    expect(() => parseEnv({DISCORD_BOT_OWNER_IDS: 'not-a-snowflake'})).toThrow(
      'Invalid environment configuration',
    );
    expect(() => parseEnv({DISCORD_DEV_GUILD_ID: '12345'})).toThrow(
      'Invalid environment configuration',
    );
  });

  it('throws on invalid runtime mode', () => {
    expect(() => parseEnv({SLEEK_RUNTIME_MODE: 'invalid'})).toThrow(
      'Invalid environment configuration',
    );
  });
});
