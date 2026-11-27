import type {PlatformId} from '../../base/common/platformId';
import type {CommandRegistry} from '../../core/commands/commandRegistry';
import type {CooldownVerdict} from '../../core/ratelimit/cooldownEngine';
import {createServiceKey} from '../../platform/di/serviceKey';

export interface GuildGovernanceState {
  readonly prefix: string;
  readonly fallbackCommaDisabled: boolean;
  readonly modlogChannelId: string | undefined;
  readonly isFrozen: boolean;
  readonly frozenReason: string | undefined;
  readonly guildAliases: Readonly<Record<string, string>>;
  readonly disabledModules: ReadonlySet<string>;
  readonly disabledCommands: ReadonlySet<string>;
  readonly ignoredChannels: ReadonlySet<string>;
  readonly ignoredUsers: ReadonlySet<string>;
}

export interface GovernanceStore {
  readonly getGuildGovernanceState: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<GuildGovernanceState>;
  readonly setGuildPrefix: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly prefix: string;
    readonly fallbackCommaDisabled: boolean;
  }) => Promise<void>;
  readonly resetGuildPrefix: (platform: PlatformId, guildId: string) => Promise<void>;
  readonly setGuildFrozen: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly frozen: boolean;
    readonly reason: string | undefined;
  }) => Promise<void>;
  readonly getPersonalPrefix: (platform: PlatformId, userId: string) => Promise<string | undefined>;
  readonly setPersonalPrefix: (
    platform: PlatformId,
    userId: string,
    prefix: string,
  ) => Promise<void>;
  readonly getUserAliases: (
    platform: PlatformId,
    userId: string,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly upsertGuildAlias: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly shortcut: string;
    readonly targetCommand: string;
    readonly actorId: string;
  }) => Promise<void>;
  readonly removeGuildAlias: (
    platform: PlatformId,
    guildId: string,
    shortcut: string,
  ) => Promise<boolean>;
  readonly resetGuildAliases: (platform: PlatformId, guildId: string) => Promise<void>;
  readonly upsertUserAlias: (options: {
    readonly platform: PlatformId;
    readonly userId: string;
    readonly shortcut: string;
    readonly targetCommand: string;
  }) => Promise<void>;
  readonly setCommandDisabled: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly commandName: string;
    readonly scopeType: 'guild' | 'channel' | 'role' | 'user';
    readonly scopeId: string;
    readonly disabled: boolean;
    readonly actorId: string;
  }) => Promise<void>;
  readonly setModuleDisabled: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly moduleId: string;
    readonly scopeType: 'guild' | 'channel' | 'role';
    readonly scopeId: string;
    readonly disabled: boolean;
    readonly actorId: string;
  }) => Promise<void>;
  readonly toggleIgnoredTarget: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetType: 'channel' | 'user';
    readonly targetId: string;
    readonly add: boolean;
    readonly actorId: string;
  }) => Promise<void>;
}

export interface GovernanceService {
  readonly getGuildState: (platform: PlatformId, guildId: string) => Promise<GuildGovernanceState>;
  readonly getPersonalPrefix: (platform: PlatformId, userId: string) => Promise<string | undefined>;
  readonly getUserAliases: (
    platform: PlatformId,
    userId: string,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly checkCooldown: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly commandName: string;
    readonly isDeveloper: boolean;
  }) => Promise<CooldownVerdict>;
  readonly isCommandDisabledInContext: (options: {
    readonly state: GuildGovernanceState;
    readonly commandName: string;
    readonly moduleId: string;
    readonly channelId: string;
    readonly actorId: string;
    readonly actorRoleIds: readonly string[];
  }) => boolean;
  readonly invalidateGuild: (platform: PlatformId, guildId: string) => Promise<void>;
  readonly flushAllCaches: () => void;
  readonly store: GovernanceStore;
  readonly registerCommands: (registry: CommandRegistry) => void;
}

export const GOVERNANCE_SERVICE_KEY = createServiceKey<GovernanceService>(
  'modules.governance.service',
);

export {MemoryGovernanceStore} from './_internal/memoryGovernanceStore';
export {createPgGovernanceStore} from './_internal/pgGovernanceStore';
