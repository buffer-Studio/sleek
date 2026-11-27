import {describe, expect, it} from 'bun:test';

import {loadSleekConfig, parseSleekConfigYaml, SleekConfigStore} from './sleekConfig';

describe('sleekConfig', () => {
  it('parses the repository config/sleek.yaml cleanly', async () => {
    const cfg = await loadSleekConfig('config/sleek.yaml');

    expect(cfg.version).toBe(1);
    expect(cfg.prefixes.defaultPrefix).toBe(',');
    expect(cfg.cooldowns.defaultMs).toBe(4000);
    expect(cfg.security.velocityTripwires.level3.burstLimit).toBe(15);
    expect(cfg.security.velocityTripwires.level3.sustainedLimit).toBe(40);
    expect(cfg.aliases.requireVoteForPersonalAliases).toBe(false);
    expect(cfg.developer.allowOverrideTrueOwnerInBot).toBe(true);
  });

  it('rejects invalid YAML policy values via Zod', () => {
    expect(() =>
      parseSleekConfigYaml(`
version: 1
prefixes:
  defaultPrefix: ""
`),
    ).toThrow('Invalid YAML policy configuration');
  });

  it('notifies listeners when SleekConfigStore updates in memory', async () => {
    const initial = await loadSleekConfig('config/sleek.yaml');
    const store = new SleekConfigStore(initial);
    let observedPrefix = '';

    const unsubscribe = store.onDidReload(next => {
      observedPrefix = next.prefixes.defaultPrefix;
    });

    store.updateInMemory({
      ...initial,
      prefixes: {...initial.prefixes, defaultPrefix: '!'},
    });

    expect(observedPrefix).toBe('!');
    unsubscribe();
  });
});
