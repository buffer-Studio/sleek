export interface PermissionTemplateDefinition {
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly string[];
}

export const BUILTIN_PERMISSION_TEMPLATES: Readonly<Record<string, PermissionTemplateDefinition>> =
  Object.freeze({
    'trial-mod': {
      name: 'trial-mod',
      description: 'Junior Staff Safety Preset (warnings, 2h max timeouts, 25 max purges)',
      nodes: [
        'moderation.warn.add',
        'moderation.warn.view',
        'moderation.timeout.apply',
        'moderation.timeout.max.2h',
        'moderation.timeout.remove',
        'moderation.purge',
        'moderation.purge.max.25',
        'moderation.case.view',
        'moderation.case.history',
        '-moderation.ban.*',
        '-moderation.kick.*',
        '-moderation.jail.*',
        '-moderation.channel.nuke',
      ],
    },
    moderator: {
      name: 'moderator',
      description: 'Full Frontline Staff',
      nodes: [
        'moderation.ban.temp',
        'moderation.ban.temp.max.7d',
        'moderation.ban.soft',
        'moderation.kick',
        'moderation.mute.*',
        'moderation.amute.*',
        'moderation.jail.*',
        'moderation.purge',
        'moderation.purge.max.100',
        'moderation.channel.lock',
        'moderation.channel.unlock',
        'moderation.case.*',
        'moderation.proof.*',
        '-moderation.ban.all',
        '-moderation.ban.mass',
        '-moderation.jail.mass',
      ],
    },
    admin: {
      name: 'admin',
      description: 'Management and Operations',
      nodes: [
        'moderation.*',
        'server.*',
        'security.staff.bind',
        'security.fakeperms.view',
        'security.quota.*',
        '-moderation.ban.all',
        '-security.admin.bind',
        '-security.actingowner.*',
        '-security.fakeperms.reset',
      ],
    },
    member: {
      name: 'member',
      description: 'Baseline @everyone bootstrap bundle',
      nodes: [
        'information.*.view',
        'server.prefix.view',
        'server.alias.view',
        'server.alias.user',
        'leveling.rank.view',
        'user.prefix.self',
        'user.reminders.manage',
        'server.snipe.view',
        'server.tagscript.eval',
      ],
    },
  });

export function getBuiltinTemplate(name: string): PermissionTemplateDefinition | undefined {
  return BUILTIN_PERMISSION_TEMPLATES[name.trim().toLowerCase()];
}
