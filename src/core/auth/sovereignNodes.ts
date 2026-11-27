import {PERMISSION_NODES} from './permissionNodeDictionary';

export const SOVEREIGN_NODES: ReadonlySet<string> = new Set(
  Object.entries(PERMISSION_NODES)
    .filter(([, meta]) => meta.sovereign)
    .map(([node]) => node),
);

export const LEGACY_NODE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'moderation.ban.permanent': 'moderation.ban',
  'moderation.purge.messages': 'moderation.purge',
  'moderation.timeout': 'moderation.timeout.apply',
  'server.lockdown': 'moderation.channel.lock',
  'bot.reload': 'bot.system.reload',
  'bot.admin.maintenance': 'bot.system.maintenance',
  'bot.guild.leave': 'bot.guilds.leave',
  'bot.guild.view': 'bot.guilds.view',
  'bot.tns.blacklist': 'bot.blacklist.add',
  'bot.support.diagnostics': 'bot.shards.view',
});

export const RETIRED_NODES: ReadonlySet<string> = new Set([
  'admin.fakeperms',
  'server.actingowner',
  'server.stripstaff',
  'antinuke.bypass',
]);

export interface NormalizedNodeResult {
  readonly canonicalNode: string;
  readonly negated: boolean;
  readonly rewrittenFrom: string | undefined;
}

export function normalizeGrantNodeInput(rawInput: string): NormalizedNodeResult {
  const trimmed = rawInput.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new Error('Permission node cannot be empty.');
  }

  const negated = trimmed.startsWith('-');
  const unsigned = negated ? trimmed.slice(1) : trimmed;
  if (unsigned.length === 0) {
    throw new Error('Negated permission node cannot be empty.');
  }

  if (RETIRED_NODES.has(unsigned)) {
    throw new Error(`Permission node '${unsigned}' is retired and rejected by design.`);
  }

  const aliased = LEGACY_NODE_ALIASES[unsigned];
  const canonicalNode = aliased ?? unsigned;

  return {
    canonicalNode,
    negated,
    rewrittenFrom: aliased !== undefined ? unsigned : undefined,
  };
}

export function isSovereignNode(node: string): boolean {
  return SOVEREIGN_NODES.has(node);
}
