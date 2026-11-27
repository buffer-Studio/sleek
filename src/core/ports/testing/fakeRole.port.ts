import type {PlatformId} from '../../../base/common/platformId';
import {err, ok, type Result} from '../../../base/common/result';
import type {RolePort, RolePortError} from '../role.port';

export interface RoleMutationRecord {
  readonly op: 'add' | 'remove';
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly reason: string;
}

export class FakeRolePort implements RolePort {
  public readonly mutations: RoleMutationRecord[] = [];
  private readonly memberRoles = new Map<string, Set<string>>();
  public failRemoveError: RolePortError | undefined;

  private memberKey(platform: PlatformId, guildId: string, userId: string): string {
    return `${platform}:${guildId}:${userId}`;
  }

  public setMemberRoles(
    platform: PlatformId,
    guildId: string,
    userId: string,
    roleIds: readonly string[],
  ): void {
    this.memberRoles.set(this.memberKey(platform, guildId, userId), new Set(roleIds));
  }

  public getStoredMemberRoles(
    platform: PlatformId,
    guildId: string,
    userId: string,
  ): readonly string[] {
    return [...(this.memberRoles.get(this.memberKey(platform, guildId, userId)) ?? [])];
  }

  public async getMemberRoles(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
  }): Promise<Result<readonly string[], RolePortError>> {
    const roles = this.memberRoles.get(
      this.memberKey(options.platform, options.guildId, options.userId),
    );
    return Promise.resolve(ok(roles === undefined ? [] : [...roles]));
  }

  public async removeMemberRoles(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly roleIds: readonly string[];
    readonly reason: string;
  }): Promise<Result<void, RolePortError>> {
    if (this.failRemoveError !== undefined) {
      return Promise.resolve(err(this.failRemoveError));
    }
    this.mutations.push({op: 'remove', ...options});
    const current = this.memberRoles.get(
      this.memberKey(options.platform, options.guildId, options.userId),
    );
    if (current !== undefined) {
      for (const roleId of options.roleIds) {
        current.delete(roleId);
      }
    }
    return Promise.resolve(ok(undefined));
  }

  public async addMemberRoles(options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly roleIds: readonly string[];
    readonly reason: string;
  }): Promise<Result<void, RolePortError>> {
    this.mutations.push({op: 'add', ...options});
    const key = this.memberKey(options.platform, options.guildId, options.userId);
    const current = this.memberRoles.get(key) ?? new Set<string>();
    for (const roleId of options.roleIds) {
      current.add(roleId);
    }
    this.memberRoles.set(key, current);
    return Promise.resolve(ok(undefined));
  }
}
