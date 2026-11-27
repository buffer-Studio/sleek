import {describe, expect, it} from 'bun:test';

import {
  type CooldownPolicy,
  createEmptyCooldownState,
  evaluateCooldownState,
} from './cooldownEngine';

const TEST_POLICY: CooldownPolicy = {
  defaultMs: 4000,
  burstMaxCount: 5,
  burstWindowMs: 5000,
  floodLockMs: 10_000,
  severeAbuseThreshold: 8,
  countRejectedInBurst: true,
  commandOverridesMs: {purge: 10_000},
};

describe('cooldownEngine', () => {
  it('enforces per-command cooldowns, burst lock, and severe abuse silent drop', () => {
    let state = createEmptyCooldownState();

    const first = evaluateCooldownState({
      state,
      commandName: 'ping',
      policy: TEST_POLICY,
      isDeveloper: false,
      developerBypassEnabled: true,
      nowMs: 10_000,
    });
    expect(first.verdict.status).toBe('allow');
    state = first.nextState;

    const second = evaluateCooldownState({
      state,
      commandName: 'ping',
      policy: TEST_POLICY,
      isDeveloper: false,
      developerBypassEnabled: true,
      nowMs: 11_000,
    });
    expect(second.verdict.status).toBe('cooldown');
    state = second.nextState;

    // trigger burst flood lock and severe abuse silent drop
    for (let i = 0; i < 7; i += 1) {
      const res = evaluateCooldownState({
        state,
        commandName: 'ping',
        policy: TEST_POLICY,
        isDeveloper: false,
        developerBypassEnabled: true,
        nowMs: 11_100 + i * 50,
      });
      state = res.nextState;
      if (i === 6) {
        expect(res.verdict.status).toBe('silent_drop');
      }
    }
  });

  it('bypasses all cooldowns for Level 5 developer', () => {
    const res = evaluateCooldownState({
      state: createEmptyCooldownState(),
      commandName: 'purge',
      policy: TEST_POLICY,
      isDeveloper: true,
      developerBypassEnabled: true,
      nowMs: 10_000,
    });
    expect(res.verdict.status).toBe('bypass_developer');
  });
});
