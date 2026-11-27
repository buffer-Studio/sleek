const INTERPOLATION_REGEX = /\{(\d+|\.\.\.)(?::([^}]*))?\}/g;

const SOVEREIGN_MACRO_BLOCKED = new Set([
  'nuke',
  'fp reset',
  'fakepermissions reset',
  'actingowner rollback',
  'actingowner grant',
  'actingowner revoke',
  'sudo',
  'sql',
  'freeze',
  'uncompromise',
  'botstaff',
]);

export function splitMacroChain(template: string, maxMacroSteps = 3): readonly string[] {
  const steps: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && ch === '&' && template[i + 1] === '&') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        steps.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }
    if (ch !== undefined) {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail.length > 0) {
    steps.push(tail);
  }

  if (steps.length === 0) {
    throw new Error('Alias target command cannot be empty.');
  }
  if (steps.length > maxMacroSteps) {
    throw new Error(`Macro chain exceeds maximum of ${maxMacroSteps} commands.`);
  }

  for (const step of steps) {
    const lower = step.toLowerCase();
    for (const blocked of SOVEREIGN_MACRO_BLOCKED) {
      if (lower === blocked || lower.startsWith(`${blocked} `)) {
        throw new Error(`Sovereign command '${blocked}' cannot be chained in an alias macro.`);
      }
    }
  }

  return steps;
}

function splitRawArgs(rawArgs: string): readonly string[] {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const args: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of trimmed) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

export function interpolateAliasStep(templateStep: string, rawArgs: string): string {
  const args = splitRawArgs(rawArgs);
  INTERPOLATION_REGEX.lastIndex = 0;
  const hasPlaceholder = INTERPOLATION_REGEX.test(templateStep);
  INTERPOLATION_REGEX.lastIndex = 0;

  const replaced = templateStep.replace(
    INTERPOLATION_REGEX,
    (_match, key: string, defaultVal: string | undefined) => {
      if (key === '...') {
        return args.length > 0 ? args.join(' ') : (defaultVal ?? '');
      }
      const idx = Number.parseInt(key, 10);
      const supplied = args[idx];
      if (supplied !== undefined && supplied.length > 0) {
        return supplied;
      }
      return defaultVal ?? '';
    },
  );

  if (!hasPlaceholder && args.length > 0) {
    return `${replaced.trim()} ${args.join(' ')}`.trim();
  }
  return replaced.replace(/\s+/g, ' ').trim();
}

export function expandAliasInvocation(
  template: string,
  rawArgs: string,
  maxMacroSteps = 3,
): readonly string[] {
  const steps = splitMacroChain(template, maxMacroSteps);
  return steps.map(step => interpolateAliasStep(step, rawArgs));
}
