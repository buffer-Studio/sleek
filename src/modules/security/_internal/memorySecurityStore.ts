import type {PlatformId} from '../../../base/common/platformId';
import type {PermissionGrantRecord} from '../../../core/auth/permissionKernel';
import type {
  ActingOwnerLedgerRecord,
  ActingOwnerRecord,
  GuildSecuritySnapshot,
  PlatformStaffRecord,
  SecurityStore,
} from '../security.contract';

interface MemoryGuildSecurityState {
  epoch: number;
  readonly staffRoles: Map<string, 'staff' | 'admin'>;
  actingOwner: ActingOwnerRecord | undefined;
  readonly grants: Map<string, PermissionGrantRecord>;
  readonly ledger: ActingOwnerLedgerRecord[];
}

export class MemorySecurityStore implements SecurityStore {
  private readonly guilds = new Map<string, MemoryGuildSecurityState>();
  private readonly platformStaff = new Map<string, PlatformStaffRecord>();
  public readonly auditLogs: Array<{
    readonly platform: PlatformId;
    readonly executorId: string;
    readonly targetGuildId: string;
    readonly commandExecuted: string;
    readonly reason: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }> = [];

  private getOrCreateGuild(platform: PlatformId, guildId: string): MemoryGuildSecurityState {
    const key = `${platform}:${guildId}`;
    let state = this.guilds.get(key);
    if (state === undefined) {
      state = {
        epoch: 1,
        staffRoles: new Map(),
        actingOwner: undefined,
        grants: new Map(),
        ledger: [],
      };
      this.guilds.set(key, state);
    }
    return state;
  }

  public async getGuildSecuritySnapshot(
    platform: PlatformId,
    guildId: string,
  ): Promise<GuildSecuritySnapshot> {
    const state = this.getOrCreateGuild(platform, guildId);
    const boundAdminRoleIds = new Set<string>();
    const boundStaffRoleIds = new Set<string>();

    for (const [roleId, tier] of state.staffRoles.entries()) {
      if (tier === 'admin') {
        boundAdminRoleIds.add(roleId);
      } else {
        boundStaffRoleIds.add(roleId);
      }
    }

    return Promise.resolve({
      epoch: state.epoch,
      boundAdminRoleIds,
      boundStaffRoleIds,
      actingOwner: state.actingOwner,
      grants: [...state.grants.values()],
    });
  }

  public async getCurrentEpoch(platform: PlatformId, guildId: string): Promise<number> {
    return Promise.resolve(this.getOrCreateGuild(platform, guildId).epoch);
  }

  public async toggleStaffRole(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly roleId: string;
    readonly tier: 'staff' | 'admin';
    readonly actorId: string;
  }): Promise<{readonly bound: boolean; readonly epoch: number}> {
    const state = this.getOrCreateGuild(options.platform, options.guildId);
    const existing = state.staffRoles.get(options.roleId);
    let bound: boolean;
    if (existing === options.tier) {
      state.staffRoles.delete(options.roleId);
      bound = false;
    } else {
      state.staffRoles.set(options.roleId, options.tier);
      bound = true;
    }
    state.epoch += 1;
    return Promise.resolve({bound, epoch: state.epoch});
  }

  public async listStaffRoles(
    platform: PlatformId,
    guildId: string,
    tier: 'staff' | 'admin',
  ): Promise<readonly string[]> {
    const state = this.getOrCreateGuild(platform, guildId);
    const result: string[] = [];
    for (const [roleId, t] of state.staffRoles.entries()) {
      if (t === tier) {
        result.push(roleId);
      }
    }
    return Promise.resolve(result);
  }

  public async addFakePermissions(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetId: string;
    readonly isRole: boolean;
    readonly nodes: readonly string[];
    readonly expiresAtMs: number | undefined;
    readonly channelScope: readonly string[] | undefined;
    readonly actorId: string;
  }): Promise<{readonly epoch: number}> {
    const state = this.getOrCreateGuild(options.platform, options.guildId);
    for (const node of options.nodes) {
      state.grants.set(`${options.targetId}:${node}`, {
        targetId: options.targetId,
        isRole: options.isRole,
        node,
        expiresAtMs: options.expiresAtMs,
        channelScope: options.channelScope,
      });
    }
    state.epoch += 1;
    return Promise.resolve({epoch: state.epoch});
  }

  public async removeFakePermissions(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetId: string;
    readonly nodes: readonly string[];
  }): Promise<{readonly removed: number; readonly epoch: number}> {
    const state = this.getOrCreateGuild(options.platform, options.guildId);
    let removed = 0;
    for (const node of options.nodes) {
      if (state.grants.delete(`${options.targetId}:${node}`)) {
        removed += 1;
      }
    }
    state.epoch += 1;
    return Promise.resolve({removed, epoch: state.epoch});
  }

  public async resetFakePermissions(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetId: string | undefined;
  }): Promise<{readonly epoch: number}> {
    const state = this.getOrCreateGuild(options.platform, options.guildId);
    if (options.targetId === undefined) {
      state.grants.clear();
    } else {
      for (const [key, grant] of state.grants.entries()) {
        if (grant.targetId === options.targetId) {
          state.grants.delete(key);
        }
      }
    }
    state.epoch += 1;
    return Promise.resolve({epoch: state.epoch});
  }

  public async countGuildBindings(platform: PlatformId, guildId: string): Promise<number> {
    return Promise.resolve(this.getOrCreateGuild(platform, guildId).grants.size);
  }

  public async setActingOwner(record: ActingOwnerRecord): Promise<{readonly epoch: number}> {
    const state = this.getOrCreateGuild(record.platform, record.guildId);
    state.actingOwner = record;
    state.epoch += 1;
    return Promise.resolve({epoch: state.epoch});
  }

  public async revokeActingOwner(
    platform: PlatformId,
    guildId: string,
  ): Promise<{readonly epoch: number}> {
    const state = this.getOrCreateGuild(platform, guildId);
    state.actingOwner = undefined;
    state.epoch += 1;
    return Promise.resolve({epoch: state.epoch});
  }

  public async setActingOwnerFrozen(
    platform: PlatformId,
    guildId: string,
    frozen: boolean,
  ): Promise<{readonly epoch: number}> {
    const state = this.getOrCreateGuild(platform, guildId);
    if (state.actingOwner !== undefined) {
      state.actingOwner = {...state.actingOwner, isFrozen: frozen};
    }
    state.epoch += 1;
    return Promise.resolve({epoch: state.epoch});
  }

  public async updateActingOwnerThresholds(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly burstLimit: number;
    readonly burstWindowSeconds: number;
    readonly sustainedLimit: number;
    readonly sustainedWindowSeconds: number;
  }): Promise<{readonly epoch: number}> {
    const state = this.getOrCreateGuild(options.platform, options.guildId);
    if (state.actingOwner !== undefined) {
      state.actingOwner = {
        ...state.actingOwner,
        burstLimit: options.burstLimit,
        burstWindowSeconds: options.burstWindowSeconds,
        sustainedLimit: options.sustainedLimit,
        sustainedWindowSeconds: options.sustainedWindowSeconds,
      };
    }
    state.epoch += 1;
    return Promise.resolve({epoch: state.epoch});
  }

  public async appendLedgerEntry(entry: ActingOwnerLedgerRecord): Promise<void> {
    const state = this.getOrCreateGuild(entry.platform, entry.guildId);
    state.ledger.push(entry);
    return Promise.resolve();
  }

  public async getSessionLedger(
    platform: PlatformId,
    guildId: string,
    sessionId: string,
  ): Promise<readonly ActingOwnerLedgerRecord[]> {
    const state = this.getOrCreateGuild(platform, guildId);
    return Promise.resolve(
      state.ledger
        .filter(item => item.sessionId === sessionId)
        .sort((a, b) => b.executedAtMs - a.executedAtMs),
    );
  }

  public async markLedgerRolledBack(
    platform: PlatformId,
    guildId: string,
    entryIds: readonly string[],
    rolledBackAtMs: number,
  ): Promise<void> {
    const state = this.getOrCreateGuild(platform, guildId);
    const idSet = new Set(entryIds);
    for (let i = 0; i < state.ledger.length; i += 1) {
      const current = state.ledger[i];
      if (current !== undefined && idSet.has(current.id)) {
        state.ledger[i] = {...current, rolledBackAtMs};
      }
    }
    return Promise.resolve();
  }

  public async getPlatformStaff(
    platform: PlatformId,
    userId: string,
  ): Promise<PlatformStaffRecord | undefined> {
    return Promise.resolve(this.platformStaff.get(`${platform}:${userId}`));
  }

  public async upsertPlatformStaff(record: PlatformStaffRecord): Promise<void> {
    this.platformStaff.set(`${record.platform}:${record.userId}`, record);
    return Promise.resolve();
  }

  public async removePlatformStaff(platform: PlatformId, userId: string): Promise<boolean> {
    return Promise.resolve(this.platformStaff.delete(`${platform}:${userId}`));
  }

  public async listPlatformStaff(platform: PlatformId): Promise<readonly PlatformStaffRecord[]> {
    const out: PlatformStaffRecord[] = [];
    for (const record of this.platformStaff.values()) {
      if (record.platform === platform) {
        out.push(record);
      }
    }
    return Promise.resolve(out);
  }

  public async insertPlatformAuditLog(entry: {
    readonly platform: PlatformId;
    readonly executorId: string;
    readonly targetGuildId: string;
    readonly commandExecuted: string;
    readonly reason: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    this.auditLogs.push(entry);
    return Promise.resolve();
  }

  public async uncompromiseMember(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetUserId: string;
  }): Promise<{readonly actingOwnerRevoked: boolean; readonly epoch: number}> {
    const state = this.getOrCreateGuild(options.platform, options.guildId);
    let actingOwnerRevoked = false;
    if (state.actingOwner?.userId === options.targetUserId) {
      state.actingOwner = undefined;
      actingOwnerRevoked = true;
    }
    for (const [key, grant] of state.grants.entries()) {
      if (!grant.isRole && grant.targetId === options.targetUserId) {
        state.grants.delete(key);
      }
    }
    state.epoch += 1;
    return Promise.resolve({actingOwnerRevoked, epoch: state.epoch});
  }
}
