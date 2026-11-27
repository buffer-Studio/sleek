import type {PlatformId} from '../../../base/common/platformId';
import type {GovernanceStore, GuildGovernanceState} from '../governance.contract';

interface MutableGuildGovernance {
  prefix: string;
  fallbackCommaDisabled: boolean;
  modlogChannelId: string | undefined;
  isFrozen: boolean;
  frozenReason: string | undefined;
  readonly guildAliases: Map<string, string>;
  readonly disabledModules: Set<string>;
  readonly disabledCommands: Set<string>;
  readonly ignoredChannels: Set<string>;
  readonly ignoredUsers: Set<string>;
}

export class MemoryGovernanceStore implements GovernanceStore {
  private readonly guilds = new Map<string, MutableGuildGovernance>();
  private readonly personalPrefixes = new Map<string, string>();
  private readonly userAliases = new Map<string, Map<string, string>>();

  private getOrCreate(platform: PlatformId, guildId: string): MutableGuildGovernance {
    const key = `${platform}:${guildId}`;
    let state = this.guilds.get(key);
    if (state === undefined) {
      state = {
        prefix: ',',
        fallbackCommaDisabled: false,
        modlogChannelId: undefined,
        isFrozen: false,
        frozenReason: undefined,
        guildAliases: new Map(),
        disabledModules: new Set(),
        disabledCommands: new Set(),
        ignoredChannels: new Set(),
        ignoredUsers: new Set(),
      };
      this.guilds.set(key, state);
    }
    return state;
  }

  public async getGuildGovernanceState(
    platform: PlatformId,
    guildId: string,
  ): Promise<GuildGovernanceState> {
    const state = this.getOrCreate(platform, guildId);
    return Promise.resolve({
      prefix: state.prefix,
      fallbackCommaDisabled: state.fallbackCommaDisabled,
      modlogChannelId: state.modlogChannelId,
      isFrozen: state.isFrozen,
      frozenReason: state.frozenReason,
      guildAliases: Object.fromEntries(state.guildAliases),
      disabledModules: new Set(state.disabledModules),
      disabledCommands: new Set(state.disabledCommands),
      ignoredChannels: new Set(state.ignoredChannels),
      ignoredUsers: new Set(state.ignoredUsers),
    });
  }

  public async setGuildPrefix(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly prefix: string;
    readonly fallbackCommaDisabled: boolean;
  }): Promise<void> {
    const state = this.getOrCreate(options.platform, options.guildId);
    state.prefix = options.prefix;
    state.fallbackCommaDisabled = options.fallbackCommaDisabled;
    return Promise.resolve();
  }

  public async resetGuildPrefix(platform: PlatformId, guildId: string): Promise<void> {
    const state = this.getOrCreate(platform, guildId);
    state.prefix = ',';
    state.fallbackCommaDisabled = false;
    return Promise.resolve();
  }

  public async setGuildFrozen(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly frozen: boolean;
    readonly reason: string | undefined;
  }): Promise<void> {
    const state = this.getOrCreate(options.platform, options.guildId);
    state.isFrozen = options.frozen;
    state.frozenReason = options.reason;
    return Promise.resolve();
  }

  public async getPersonalPrefix(
    platform: PlatformId,
    userId: string,
  ): Promise<string | undefined> {
    return Promise.resolve(this.personalPrefixes.get(`${platform}:${userId}`));
  }

  public async setPersonalPrefix(
    platform: PlatformId,
    userId: string,
    prefix: string,
  ): Promise<void> {
    this.personalPrefixes.set(`${platform}:${userId}`, prefix);
    return Promise.resolve();
  }

  public async getUserAliases(
    platform: PlatformId,
    userId: string,
  ): Promise<Readonly<Record<string, string>>> {
    const map = this.userAliases.get(`${platform}:${userId}`);
    return Promise.resolve(map === undefined ? {} : Object.fromEntries(map));
  }

  public async upsertGuildAlias(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly shortcut: string;
    readonly targetCommand: string;
    readonly actorId: string;
  }): Promise<void> {
    const state = this.getOrCreate(options.platform, options.guildId);
    state.guildAliases.set(options.shortcut.toLowerCase(), options.targetCommand);
    return Promise.resolve();
  }

  public async removeGuildAlias(
    platform: PlatformId,
    guildId: string,
    shortcut: string,
  ): Promise<boolean> {
    const state = this.getOrCreate(platform, guildId);
    return Promise.resolve(state.guildAliases.delete(shortcut.toLowerCase()));
  }

  public async resetGuildAliases(platform: PlatformId, guildId: string): Promise<void> {
    const state = this.getOrCreate(platform, guildId);
    state.guildAliases.clear();
    return Promise.resolve();
  }

  public async upsertUserAlias(options: {
    readonly platform: PlatformId;
    readonly userId: string;
    readonly shortcut: string;
    readonly targetCommand: string;
  }): Promise<void> {
    const key = `${options.platform}:${options.userId}`;
    let map = this.userAliases.get(key);
    if (map === undefined) {
      map = new Map();
      this.userAliases.set(key, map);
    }
    map.set(options.shortcut.toLowerCase(), options.targetCommand);
    return Promise.resolve();
  }

  public async setCommandDisabled(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly commandName: string;
    readonly scopeType: 'guild' | 'channel' | 'role' | 'user';
    readonly scopeId: string;
    readonly disabled: boolean;
    readonly actorId: string;
  }): Promise<void> {
    const state = this.getOrCreate(options.platform, options.guildId);
    const key = `${options.commandName.toLowerCase()}:${options.scopeType}:${options.scopeId}`;
    if (options.disabled) {
      state.disabledCommands.add(key);
    } else {
      state.disabledCommands.delete(key);
    }
    return Promise.resolve();
  }

  public async setModuleDisabled(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly moduleId: string;
    readonly scopeType: 'guild' | 'channel' | 'role';
    readonly scopeId: string;
    readonly disabled: boolean;
    readonly actorId: string;
  }): Promise<void> {
    const state = this.getOrCreate(options.platform, options.guildId);
    const key = `${options.moduleId.toLowerCase()}:${options.scopeType}:${options.scopeId}`;
    if (options.disabled) {
      state.disabledModules.add(key);
    } else {
      state.disabledModules.delete(key);
    }
    return Promise.resolve();
  }

  public async toggleIgnoredTarget(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetType: 'channel' | 'user';
    readonly targetId: string;
    readonly add: boolean;
    readonly actorId: string;
  }): Promise<void> {
    const state = this.getOrCreate(options.platform, options.guildId);
    const set = options.targetType === 'channel' ? state.ignoredChannels : state.ignoredUsers;
    if (options.add) {
      set.add(options.targetId);
    } else {
      set.delete(options.targetId);
    }
    return Promise.resolve();
  }
}
