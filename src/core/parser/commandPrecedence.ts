export const SOVEREIGN_CORE_TRIGGERS: ReadonlySet<string> = new Set([
  'actingowner',
  'fakepermissions',
  'fp',
  'antinuke',
  'bind',
  'bindadmin',
  'bindstaff',
  'strip',
  'stripstaff',
  'stripadmin',
  'sudo',
  'freeze',
  'unfreeze',
  'uncompromise',
  'sql',
  'stats',
  'reload',
  'botstaff',
  'enablecommand',
  'ecmd',
  'disablecommand',
  'dcmd',
  'enablemodule',
  'em',
  'disablemodule',
  'dm',
]);

export const BUILTIN_SHORT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  dcmd: 'disablecommand',
  ecmd: 'enablecommand',
  dm: 'disablemodule',
  em: 'enablemodule',
  fp: 'fakepermissions',
  an: 'antinuke',
  b: 'ban',
  rban: 'recentban',
  ub: 'unban',
  sb: 'softban',
  t: 'timeout',
  ut: 'untimeout',
  m: 'mute',
  um: 'unmute',
  j: 'jail',
  uj: 'unjail',
  w: 'warn',
  notes: 'note',
  case: 'caselog',
  update: 'reason',
  cases: 'history',
  p: 'purge',
  c: 'purge',
  cleaninvites: 'clearinvites',
  lock: 'lockdown',
  restore: 'role restore',
  rcancel: 'role cancel',
  aliases: 'alias list',
  remind: 'reminders',
  rm: 'reminders',
  firstmsg: 'firstmessage',
  fm: 'firstmessage',
  cc: 'component create',
  ce: 'component edit',
  f: 'filter',
  jg: 'joingate',
  rep: 'reposter',
  ar: 'autoresponder',
  wlc: 'welcome',
  gb: 'goodbye',
  hp: 'honeypot',
});

export type TriggerResolutionKind =
  'sovereign_core' | 'guild_alias' | 'user_alias' | 'builtin_shortcut' | 'direct_command';

export interface TriggerResolution {
  readonly kind: TriggerResolutionKind;
  readonly trigger: string;
  readonly expandedTemplate: string;
  readonly forcedPersonal: boolean;
}

export function resolveCommandPrecedence(options: {
  readonly rawTrigger: string;
  readonly guildAliases: Readonly<Record<string, string>>;
  readonly userAliases: Readonly<Record<string, string>>;
  readonly registeredCommands: ReadonlySet<string>;
}): TriggerResolution | undefined {
  const lower = options.rawTrigger.trim().toLowerCase();
  if (lower.length === 0) {
    return undefined;
  }

  // personal namespace override: me:<alias> or u:<alias>
  if (lower.startsWith('me:') || lower.startsWith('u:')) {
    const personalName = lower.startsWith('me:') ? lower.slice(3) : lower.slice(2);
    const personalTarget = options.userAliases[personalName];
    if (personalTarget === undefined) {
      return undefined;
    }
    return {
      kind: 'user_alias',
      trigger: personalName,
      expandedTemplate: personalTarget,
      forcedPersonal: true,
    };
  }

  // tier 1: sovereign core commands (cannot be shadowed)
  if (SOVEREIGN_CORE_TRIGGERS.has(lower)) {
    const mapped = BUILTIN_SHORT_ALIASES[lower] ?? lower;
    return {
      kind: 'sovereign_core',
      trigger: lower,
      expandedTemplate: mapped,
      forcedPersonal: false,
    };
  }

  // tier 2: guild command aliases
  const guildTarget = options.guildAliases[lower];
  if (guildTarget !== undefined) {
    return {
      kind: 'guild_alias',
      trigger: lower,
      expandedTemplate: guildTarget,
      forcedPersonal: false,
    };
  }

  // tier 3: personal user aliases
  const userTarget = options.userAliases[lower];
  if (userTarget !== undefined) {
    return {
      kind: 'user_alias',
      trigger: lower,
      expandedTemplate: userTarget,
      forcedPersonal: false,
    };
  }

  // tier 4: built-in system shortcuts
  const builtinTarget = BUILTIN_SHORT_ALIASES[lower];
  if (builtinTarget !== undefined) {
    return {
      kind: 'builtin_shortcut',
      trigger: lower,
      expandedTemplate: builtinTarget,
      forcedPersonal: false,
    };
  }

  if (options.registeredCommands.has(lower)) {
    return {
      kind: 'direct_command',
      trigger: lower,
      expandedTemplate: lower,
      forcedPersonal: false,
    };
  }

  return undefined;
}
