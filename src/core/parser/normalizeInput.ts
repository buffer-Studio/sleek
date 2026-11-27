export function normalizeCommandInput(raw: string): string {
  let out = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === undefined) {
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      out += ch;
      continue;
    }

    if (!inQuotes && (ch === '\u2014' || ch === '\u2013')) {
      const prev = i > 0 ? raw[i - 1] : ' ';
      const next = i + 1 < raw.length ? raw[i + 1] : '';
      const atTokenStart = prev === ' ' || prev === '\t' || prev === '\n';
      const beforeAsciiLetter = next !== undefined && /^[a-zA-Z]$/.test(next);
      if (atTokenStart && beforeAsciiLetter) {
        out += '--';
        continue;
      }
    }

    out += ch;
  }

  return out;
}
