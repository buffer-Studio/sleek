import {describe, expect, it} from 'bun:test';

import {COMMAND_FLAG_BIT, hasFlagBit} from './commandFlagBits';
import {parseCommandArgs} from './commandParser';

describe('commandParser', () => {
  it('parses disordered moderation arguments with chained flags and Unicode dashes', () => {
    const parsed = parseCommandArgs(
      '\u2014reason Toxicity in voice chat —silent <@123456789012345678> 7d -nd',
      {adaptiveModeration: true},
    );

    expect(parsed.targets).toEqual(['123456789012345678']);
    expect(parsed.durationMs).toBe(7 * 86_400_000);
    expect(parsed.reason).toBe('Toxicity in voice chat');
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.Silent)).toBe(true);
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.NoDm)).toBe(true);
  });

  it('handles -snd short flag chaining and -del disambiguation', () => {
    const parsed = parseCommandArgs('<@123456789012345678> 1d -del 7d -snd Raid wave', {
      adaptiveModeration: true,
    });

    expect(parsed.durationMs).toBe(86_400_000);
    expect(parsed.deleteDurationMs).toBe(7 * 86_400_000);
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.Silent)).toBe(true);
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.NoDm)).toBe(true);
  });

  it('preserves mid-sentence bare words and durations in prose reasons (two-zone invariant)', () => {
    const parsed = parseCommandArgs(
      '<@123456789012345678> Joined 5m ago and stayed silent in general',
      {adaptiveModeration: true},
    );

    expect(parsed.durationMs).toBeUndefined();
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.Silent)).toBe(false);
    expect(parsed.reason).toBe('Joined 5m ago and stayed silent in general');
  });

  it('extracts head/tail bare keywords and media proof URLs', () => {
    const parsed = parseCommandArgs(
      'severe advertising <@123456789012345678> 1d https://cdn.discordapp.com/attachments/proof.png silent nodm',
      {adaptiveModeration: true},
    );

    expect(parsed.targets).toEqual(['123456789012345678']);
    expect(parsed.durationMs).toBe(86_400_000);
    expect(parsed.mediaUrls).toEqual(['https://cdn.discordapp.com/attachments/proof.png']);
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.Silent)).toBe(true);
    expect(hasFlagBit(parsed.flagsMask, COMMAND_FLAG_BIT.NoDm)).toBe(true);
    expect(parsed.reason).toBe('severe advertising');
  });
});
