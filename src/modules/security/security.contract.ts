import type {PlatformId} from '../../base/common/platformId';
import type {AuthorityLevel, GlobalBotStaffTier} from '../../core/auth/authorityLevel';
import type {PermissionDecision, PermissionGrantRecord} from '../../core/auth/permissionKernel';
import type {CommandRegistry} from '../../core/commands/commandRegistry';
import {createServiceKey} from '../../platform/di/serviceKey';

export interface ActingOwnerRecord {
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly userId: string;
  readonly grantedNodes: readonly string[];
  readonly leaseExpiresAtMs: number | undefined;
  readonly sessionId: string;
  readonly burstLimit: number;
  readonly burstWindowSeconds: number;
  readonly sustainedLimit: number;
  readonly sustainedWindowSeconds: number;
  readonly isCompleteTrust: boolean;
  readonly isRolling: boolean;
  readonly trustExpiresAtMs: number | undefined;
  readonly isFrozen: boolean;
  readonly addedBy: string;
}

export interface ActingOwnerLedgerRecord {
  readonly id: string;
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly sessionId: string;
  readonly actionType: string;
  readonly inverseAction: string | undefined;
  readonly targetId: string | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly executedAtMs: number;
  readonly rolledBackAtMs: number | undefined;
}

export interface PlatformStaffRecord {
  readonly platform: PlatformId;
  readonly userId: string;
  readonly tier: 'support' | 'tns' | 'admin' | 'developer';
  readonly grantedNodes: readonly string[];
  readonly addedBy: string;
}

export interface GuildSecuritySnapshot {
  readonly epoch: number;
  readonly boundAdminRoleIds: ReadonlySet<string>;
  readonly boundStaffRoleIds: ReadonlySet<string>;
  readonly actingOwner: ActingOwnerRecord | undefined;
  readonly grants: readonly PermissionGrantRecord[];
}

export interface SecurityStore {
  readonly getGuildSecuritySnapshot: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<GuildSecuritySnapshot>;
  readonly getCurrentEpoch: (platform: PlatformId, guildId: string) => Promise<number>;
  readonly toggleStaffRole: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly roleId: string;
    readonly tier: 'staff' | 'admin';
    readonly actorId: string;
  }) => Promise<{readonly bound: boolean; readonly epoch: number}>;
  readonly listStaffRoles: (
    platform: PlatformId,
    guildId: string,
    tier: 'staff' | 'admin',
  ) => Promise<readonly string[]>;
  readonly addFakePermissions: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetId: string;
    readonly isRole: boolean;
    readonly nodes: readonly string[];
    readonly expiresAtMs: number | undefined;
    readonly channelScope: readonly string[] | undefined;
    readonly actorId: string;
  }) => Promise<{readonly epoch: number}>;
  readonly removeFakePermissions: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetId: string;
    readonly nodes: readonly string[];
  }) => Promise<{readonly removed: number; readonly epoch: number}>;
  readonly resetFakePermissions: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetId: string | undefined;
  }) => Promise<{readonly epoch: number}>;
  readonly countGuildBindings: (platform: PlatformId, guildId: string) => Promise<number>;
  readonly setActingOwner: (record: ActingOwnerRecord) => Promise<{readonly epoch: number}>;
  readonly revokeActingOwner: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<{readonly epoch: number}>;
  readonly setActingOwnerFrozen: (
    platform: PlatformId,
    guildId: string,
    frozen: boolean,
  ) => Promise<{readonly epoch: number}>;
  readonly updateActingOwnerThresholds: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly burstLimit: number;
    readonly burstWindowSeconds: number;
    readonly sustainedLimit: number;
    readonly sustainedWindowSeconds: number;
  }) => Promise<{readonly epoch: number}>;
  readonly appendLedgerEntry: (entry: ActingOwnerLedgerRecord) => Promise<void>;
  readonly getSessionLedger: (
    platform: PlatformId,
    guildId: string,
    sessionId: string,
  ) => Promise<readonly ActingOwnerLedgerRecord[]>;
  readonly markLedgerRolledBack: (
    platform: PlatformId,
    guildId: string,
    entryIds: readonly string[],
    rolledBackAtMs: number,
  ) => Promise<void>;
  readonly getPlatformStaff: (
    platform: PlatformId,
    userId: string,
  ) => Promise<PlatformStaffRecord | undefined>;
  readonly upsertPlatformStaff: (record: PlatformStaffRecord) => Promise<void>;
  readonly removePlatformStaff: (platform: PlatformId, userId: string) => Promise<boolean>;
  readonly listPlatformStaff: (platform: PlatformId) => Promise<readonly PlatformStaffRecord[]>;
  readonly insertPlatformAuditLog: (entry: {
    readonly platform: PlatformId;
    readonly executorId: string;
    readonly targetGuildId: string;
    readonly commandExecuted: string;
    readonly reason: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<void>;
  readonly uncompromiseMember: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly targetUserId: string;
  }) => Promise<{readonly actingOwnerRevoked: boolean; readonly epoch: number}>;
}

export interface AuthorizeCommandInput {
  readonly platform: PlatformId;
  readonly guildId: string | undefined;
  readonly channelId: string;
  readonly isDm: boolean;
  readonly moduleEnabled: boolean;
  readonly commandNode: string;
  readonly actorId: string;
  readonly guildOwnerId: string | undefined;
  readonly actorRoleIds: readonly string[];
  readonly ownershipSatisfied?: boolean;
  readonly requestedDurationMs?: number;
  readonly requestedCount?: number;
}

export interface SecurityService {
  readonly isBotOwner: (platform: PlatformId, userId: string) => boolean;
  readonly resolveBotStaffTier: (
    platform: PlatformId,
    userId: string,
  ) => Promise<{readonly tier: GlobalBotStaffTier; readonly nodes: readonly string[]}>;
  readonly resolveActorLevel: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly guildOwnerId: string | undefined;
    readonly roleIds: readonly string[];
  }) => Promise<AuthorityLevel>;
  readonly authorize: (input: AuthorizeCommandInput) => Promise<PermissionDecision>;
  readonly assertEpochUnchanged: (
    platform: PlatformId,
    guildId: string,
    expectedEpoch: number,
  ) => Promise<boolean>;
  readonly invalidateGuildCache: (platform: PlatformId, guildId: string) => Promise<void>;
  readonly flushAllCaches: () => void;
  readonly recordStateChangeAndCheckVelocity: (options: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly actorId: string;
    readonly actorLevel: AuthorityLevel;
    readonly actionType: string;
    readonly targetId?: string;
    readonly inverseAction?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  }) => Promise<{readonly tripped: boolean; readonly reason: string | undefined}>;
  readonly store: SecurityStore;
  readonly registerCommands: (registry: CommandRegistry) => void;
}

export const SECURITY_SERVICE_KEY = createServiceKey<SecurityService>('modules.security.service');

export const SECURITY_SLASH_COMMANDS = [
  {
    name: 'bind',
    description: 'Bind or list Staff and Admin governance roles',
    options: [
      {
        type: 1,
        name: 'admin',
        description: 'Toggle or list bound Admin roles (L2 — True Owner+ only)',
        options: [
          {
            type: 8,
            name: 'role',
            description: 'Role to bind or unbind as Bound Admin',
            required: false,
          },
          {
            type: 3,
            name: 'action',
            description: 'Optional action (list bound admin roles)',
            required: false,
            choices: [{name: 'list', value: 'list'}],
          },
        ],
      },
      {
        type: 1,
        name: 'staff',
        description: 'Toggle or list bound Staff roles (L1 — Bound Admin+ only)',
        options: [
          {
            type: 8,
            name: 'role',
            description: 'Role to bind or unbind as Bound Staff',
            required: false,
          },
          {
            type: 3,
            name: 'action',
            description: 'Optional action (list bound staff roles)',
            required: false,
            choices: [{name: 'list', value: 'list'}],
          },
        ],
      },
    ],
  },
  {
    name: 'stripadmin',
    description: 'Strip all bound admin roles from a member (True Owner+ only)',
    options: [
      {
        type: 6,
        name: 'member',
        description: 'Member to strip bound admin roles from',
        required: true,
      },
      {
        type: 3,
        name: 'reason',
        description: 'Optional audit log reason',
        required: false,
      },
    ],
  },
  {
    name: 'stripstaff',
    description: 'Strip all bound staff roles from a member (Bound Admin+ only)',
    options: [
      {
        type: 6,
        name: 'member',
        description: 'Member to strip bound staff roles from',
        required: true,
      },
      {
        type: 3,
        name: 'reason',
        description: 'Optional audit log reason',
        required: false,
      },
    ],
  },
] as const;

export {MemorySecurityStore} from './_internal/memorySecurityStore';
export {createPgSecurityStore} from './_internal/pgSecurityStore';
