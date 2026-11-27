const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DURATION_TOKEN_REGEX = /^(?:\d+[wWdDhHmMsS])+$/;
const DURATION_PAIR_REGEX = /(\d+)([wWdDhHmMsS])/g;

export const MAX_DURATION_MS = 365 * 86_400_000;

export function isDurationToken(token: string): boolean {
  return DURATION_TOKEN_REGEX.test(token);
}

export function parseDurationMs(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!DURATION_TOKEN_REGEX.test(trimmed)) {
    return undefined;
  }

  let totalMs = 0;
  DURATION_PAIR_REGEX.lastIndex = 0;
  let match = DURATION_PAIR_REGEX.exec(trimmed);
  while (match !== null) {
    const amountRaw = match[1];
    const unitRaw = match[2];
    if (amountRaw === undefined || unitRaw === undefined) {
      return undefined;
    }
    const amount = Number.parseInt(amountRaw, 10);
    const unitMs = UNIT_MS[unitRaw.toLowerCase()];
    if (!Number.isSafeInteger(amount) || unitMs === undefined) {
      return undefined;
    }
    totalMs += amount * unitMs;
    if (!Number.isSafeInteger(totalMs) || totalMs > MAX_DURATION_MS) {
      return undefined;
    }
    match = DURATION_PAIR_REGEX.exec(trimmed);
  }

  return totalMs > 0 ? totalMs : undefined;
}

export function formatDurationCompact(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}
