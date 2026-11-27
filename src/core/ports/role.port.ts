import type {PlatformId} from '../../base/common/platformId';
import type {Result} from '../../base/common/result';

export interface RolePortError {
  readonly code: string;
  readonly message: string;
}

export interface RolePort {
  readonly removeMemberRoles: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly roleIds: readonly string[];
    readonly reason: string;
  }) => Promise<Result<void, RolePortError>>;
  readonly addMemberRoles: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly roleIds: readonly string[];
    readonly reason: string;
  }) => Promise<Result<void, RolePortError>>;
  readonly getMemberRoles?: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
  }) => Promise<Result<readonly string[], RolePortError>>;
}
