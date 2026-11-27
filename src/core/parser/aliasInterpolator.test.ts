import {describe, expect, it} from 'bun:test';

import {expandAliasInvocation} from './aliasInterpolator';
import {resolveCommandPrecedence} from './commandPrecedence';

describe('aliasInterpolator & commandPrecedence', () => {
  it('interpolates positional args with default fallbacks', () => {
    const a = expandAliasInvocation('mute {0} 10m --reason "{1:Chat disruption}"', '@user');
    expect(a).toEqual(['mute @user 10m --reason "Chat disruption"']);

    const b = expandAliasInvocation('mute {0} 10m --reason "{1:Chat disruption}"', '@user Spam');
    expect(b).toEqual(['mute @user 10m --reason "Spam"']);
  });

  it('enforces max 3 macro steps and blocks sovereign commands in macros', () => {
    const ok = expandAliasInvocation('lockdown #general && slowmode 15s', '');
    expect(ok).toEqual(['lockdown #general', 'slowmode 15s']);

    expect(() => expandAliasInvocation('a && b && c && d', '')).toThrow('exceeds maximum of 3');
    expect(() => expandAliasInvocation('lockdown #general && fp reset', '')).toThrow(
      'cannot be chained',
    );
  });

  it('enforces 4-tier collision precedence and me:/u: personal namespace', () => {
    const registered = new Set(['ban', 'mute', 'fp']);

    const sov = resolveCommandPrecedence({
      rawTrigger: 'fp',
      guildAliases: {fp: 'ban'},
      userAliases: {fp: 'mute'},
      registeredCommands: registered,
    });
    expect(sov?.kind).toBe('sovereign_core');

    const guildWins = resolveCommandPrecedence({
      rawTrigger: 'shh',
      guildAliases: {shh: 'slowmode 10s'},
      userAliases: {shh: 'mute {0} 10m'},
      registeredCommands: registered,
    });
    expect(guildWins?.kind).toBe('guild_alias');

    const forcedPersonal = resolveCommandPrecedence({
      rawTrigger: 'me:shh',
      guildAliases: {shh: 'slowmode 10s'},
      userAliases: {shh: 'mute {0} 10m'},
      registeredCommands: registered,
    });
    expect(forcedPersonal?.kind).toBe('user_alias');
    expect(forcedPersonal?.forcedPersonal).toBe(true);
  });
});
