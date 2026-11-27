import {COMMAND_FLAG_BIT, type CommandFlagBitValue} from './commandFlagBits';
import {isDurationToken, parseDurationMs} from './durationParser';
import {normalizeCommandInput} from './normalizeInput';

export interface ParsedCommandArgs {
  readonly flagsMask: number;
  readonly durationMs: number | undefined;
  readonly deleteDurationMs: number | undefined;
  readonly reason: string | undefined;
  readonly targets: readonly string[];
  readonly mediaUrls: readonly string[];
  readonly channelRef: string | undefined;
  readonly selectId: string | undefined;
  readonly colorHex: string | undefined;
  readonly doAction: string | undefined;
  readonly threshold: number | undefined;
  readonly positionalArgs: readonly string[];
}

export interface ParseCommandOptions {
  readonly adaptiveModeration?: boolean;
  readonly acceptsDuration?: boolean;
}

interface TokenItem {
  readonly value: string;
  readonly quoted: boolean;
}

const LONG_BOOLEAN_FLAGS: Readonly<Record<string, CommandFlagBitValue>> = {
  '--silent': COMMAND_FLAG_BIT.Silent,
  '--nodm': COMMAND_FLAG_BIT.NoDm,
  '--dm': COMMAND_FLAG_BIT.NoDm,
  '--all': COMMAND_FLAG_BIT.All,
  '--mass': COMMAND_FLAG_BIT.Mass,
  '--internal': COMMAND_FLAG_BIT.Internal,
  '--ephemeral': COMMAND_FLAG_BIT.Ephemeral,
  '--force': COMMAND_FLAG_BIT.Force,
  '--anon': COMMAND_FLAG_BIT.Anon,
  '--real': COMMAND_FLAG_BIT.Real,
  '--test': COMMAND_FLAG_BIT.Preview,
  '--preview': COMMAND_FLAG_BIT.Preview,
  '--sticky': COMMAND_FLAG_BIT.Sticky,
  '--hidden': COMMAND_FLAG_BIT.Hidden,
  '--csv': COMMAND_FLAG_BIT.Csv,
  '--lock': COMMAND_FLAG_BIT.Lock,
  '--punish': COMMAND_FLAG_BIT.Punish,
  '--ignore-admins': COMMAND_FLAG_BIT.IgnoreAdmins,
  '--fallback': COMMAND_FLAG_BIT.Fallback,
};

const SHORT_CHAR_FLAGS: Readonly<Record<string, CommandFlagBitValue>> = {
  s: COMMAND_FLAG_BIT.Silent,
  a: COMMAND_FLAG_BIT.All,
  m: COMMAND_FLAG_BIT.Mass,
  i: COMMAND_FLAG_BIT.Internal,
  e: COMMAND_FLAG_BIT.Ephemeral,
  f: COMMAND_FLAG_BIT.Force,
};

const MENTION_OR_SNOWFLAKE_REGEX = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/;
const CHANNEL_REF_REGEX = /^<#(\d{17,20})>$/;
const URL_REGEX = /^https?:\/\/\S+$/i;

function tokenizeInput(normalized: string): TokenItem[] {
  const tokens: TokenItem[] = [];
  let current = '';
  let inQuotes = false;
  let wasQuoted = false;

  for (const ch of normalized) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      wasQuoted = true;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0 || wasQuoted) {
        tokens.push({value: current, quoted: wasQuoted});
        current = '';
        wasQuoted = false;
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0 || wasQuoted) {
    tokens.push({value: current, quoted: wasQuoted});
  }

  return tokens;
}

function isValuedFlagToken(token: string): boolean {
  const lower = token.toLowerCase();
  return (
    lower === '-d' ||
    lower === '--duration' ||
    lower === '-del' ||
    lower === '--del' ||
    lower === '-r' ||
    lower === '--reason' ||
    lower === '-c' ||
    lower === '--channel' ||
    lower === '--color' ||
    lower === '--do' ||
    lower === '-t' ||
    lower === '--threshold'
  );
}

function tryConsumeShortBooleanCluster(token: string): number | undefined {
  if (!token.startsWith('-') || token.startsWith('--') || token.length < 2) {
    return undefined;
  }
  let rest = token.slice(1).toLowerCase();
  let mask = 0;

  while (rest.length > 0) {
    if (rest.startsWith('nd') || rest.startsWith('dm')) {
      mask |= COMMAND_FLAG_BIT.NoDm;
      rest = rest.slice(2);
      continue;
    }
    const ch = rest[0];
    if (ch === undefined) {
      return undefined;
    }
    const bit = SHORT_CHAR_FLAGS[ch];
    if (bit === undefined) {
      return undefined;
    }
    mask |= bit;
    rest = rest.slice(1);
  }

  return mask;
}

function bareKeywordToBit(token: string): number | undefined {
  switch (token.toLowerCase()) {
    case 'silent':
      return COMMAND_FLAG_BIT.Silent;
    case 'nodm':
    case 'no-dm':
      return COMMAND_FLAG_BIT.NoDm;
    case 'internal':
      return COMMAND_FLAG_BIT.Internal;
    default:
      return undefined;
  }
}

export function parseCommandArgs(
  rawInput: string,
  options: ParseCommandOptions = {},
): ParsedCommandArgs {
  const normalized = normalizeCommandInput(rawInput);
  const tokens = tokenizeInput(normalized);

  let flagsMask = 0;
  let durationMs: number | undefined;
  let deleteDurationMs: number | undefined;
  let explicitReason: string | undefined;
  let channelRef: string | undefined;
  let selectId: string | undefined;
  let colorHex: string | undefined;
  let doAction: string | undefined;
  let threshold: number | undefined;
  const targets: string[] = [];
  const mediaUrls: string[] = [];
  const remaining: TokenItem[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }

    if (token.quoted) {
      remaining.push(token);
      continue;
    }

    const lower = token.value.toLowerCase();

    const longBit = LONG_BOOLEAN_FLAGS[lower];
    if (longBit !== undefined) {
      flagsMask |= longBit;
      continue;
    }

    if (lower === '-d' || lower === '--duration') {
      const next = tokens[i + 1];
      if (next !== undefined) {
        const parsed = parseDurationMs(next.value);
        if (parsed !== undefined) {
          durationMs = parsed;
          i += 1;
          continue;
        }
      }
    }

    if (lower === '-del' || lower === '--del') {
      const next = tokens[i + 1];
      if (next !== undefined) {
        const parsed = parseDurationMs(next.value);
        if (parsed !== undefined) {
          deleteDurationMs = parsed;
          i += 1;
          continue;
        }
      }
    }

    if (lower === '-c' || lower === '--channel') {
      const next = tokens[i + 1];
      if (next !== undefined) {
        const chanMatch = CHANNEL_REF_REGEX.exec(next.value);
        channelRef = chanMatch?.[1] ?? next.value;
        i += 1;
        continue;
      }
    }

    if (lower === '--color') {
      const next = tokens[i + 1];
      if (next !== undefined) {
        colorHex = next.value;
        i += 1;
        continue;
      }
    }

    if (lower === '--do') {
      const next = tokens[i + 1];
      if (next !== undefined) {
        doAction = next.value.toLowerCase();
        i += 1;
        continue;
      }
    }

    if (lower === '-t' || lower === '--threshold') {
      const next = tokens[i + 1];
      if (next !== undefined && /^\d+$/.test(next.value)) {
        threshold = Number.parseInt(next.value, 10);
        i += 1;
        continue;
      }
    }

    if (lower === '-r' || lower === '--reason') {
      const reasonParts: string[] = [];
      while (i + 1 < tokens.length) {
        const peek = tokens[i + 1];
        if (peek === undefined) {
          break;
        }
        if (
          !peek.quoted &&
          (LONG_BOOLEAN_FLAGS[peek.value.toLowerCase()] !== undefined ||
            isValuedFlagToken(peek.value) ||
            tryConsumeShortBooleanCluster(peek.value) !== undefined)
        ) {
          break;
        }
        reasonParts.push(peek.value);
        i += 1;
      }
      if (reasonParts.length > 0) {
        explicitReason = reasonParts.join(' ');
      }
      continue;
    }

    const shortMask = tryConsumeShortBooleanCluster(token.value);
    if (shortMask !== undefined) {
      flagsMask |= shortMask;
      continue;
    }

    if (lower.startsWith('select:')) {
      const id = token.value.slice('select:'.length).trim();
      if (id.length > 0) {
        selectId = id;
        continue;
      }
    }

    const mentionMatch = MENTION_OR_SNOWFLAKE_REGEX.exec(token.value);
    if (mentionMatch !== null) {
      const resolvedId = mentionMatch[1] ?? mentionMatch[2];
      if (resolvedId !== undefined) {
        targets.push(resolvedId);
        continue;
      }
    }

    if (URL_REGEX.test(token.value)) {
      mediaUrls.push(token.value);
      continue;
    }

    remaining.push(token);
  }

  // zone 2: head/tail envelope extraction for bare durations & bare adaptive keywords
  let start = 0;
  let end = remaining.length;

  const allowBareDuration =
    (options.acceptsDuration === true || options.adaptiveModeration === true) &&
    durationMs === undefined;

  if (options.adaptiveModeration === true || allowBareDuration) {
    while (start < end) {
      const head = remaining[start];
      if (head === undefined || head.quoted) {
        break;
      }
      if (allowBareDuration && durationMs === undefined && isDurationToken(head.value)) {
        durationMs = parseDurationMs(head.value);
        start += 1;
        continue;
      }
      if (options.adaptiveModeration === true) {
        const kwBit = bareKeywordToBit(head.value);
        if (kwBit !== undefined) {
          flagsMask |= kwBit;
          start += 1;
          continue;
        }
      }
      break;
    }

    while (end > start) {
      const tail = remaining[end - 1];
      if (tail === undefined || tail.quoted) {
        break;
      }
      if (allowBareDuration && durationMs === undefined && isDurationToken(tail.value)) {
        durationMs = parseDurationMs(tail.value);
        end -= 1;
        continue;
      }
      if (options.adaptiveModeration === true) {
        const kwBit = bareKeywordToBit(tail.value);
        if (kwBit !== undefined) {
          flagsMask |= kwBit;
          end -= 1;
          continue;
        }
      }
      break;
    }
  }

  const positionalTokens = remaining.slice(start, end).map(t => t.value);
  const fallbackReason =
    explicitReason ?? (positionalTokens.length > 0 ? positionalTokens.join(' ') : undefined);

  return {
    flagsMask,
    durationMs,
    deleteDurationMs,
    reason: fallbackReason,
    targets,
    mediaUrls,
    channelRef,
    selectId,
    colorHex,
    doAction,
    threshold,
    positionalArgs: positionalTokens,
  };
}
