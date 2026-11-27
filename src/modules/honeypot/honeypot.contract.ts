import type {Disposable} from '../../base/common/disposable';
import type {PlatformId} from '../../base/common/platformId';
import type {CommandRegistry} from '../../core/commands/commandRegistry';
import {createServiceKey} from '../../platform/di/serviceKey';
import type {HoneypotAction} from './schema/honeypot.table';

export interface HoneypotConfig {
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly channelId: string;
  readonly action: HoneypotAction;
  readonly deleteMessageSeconds: number;
  readonly customMessage: string | undefined;
  readonly dmMessage: string | undefined;
  readonly warningMessageId: string | undefined;
  readonly counterMessageId: string | undefined;
  readonly logChannelId: string | undefined;
  readonly detectionCount: number;
  readonly enabled: boolean;
  readonly updatedAtMs: number;
}

export interface UpsertHoneypotConfigInput {
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly channelId: string;
  readonly action: HoneypotAction;
  readonly deleteMessageSeconds: number;
  readonly customMessage: string | undefined;
  readonly dmMessage: string | undefined;
  readonly warningMessageId?: string;
  readonly counterMessageId?: string;
  readonly logChannelId?: string;
  readonly enabled?: boolean;
}

export interface HoneypotStore {
  readonly getConfig: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<HoneypotConfig | undefined>;
  readonly upsertConfig: (input: UpsertHoneypotConfigInput) => Promise<HoneypotConfig>;
  readonly updateWarningMessageId: (
    platform: PlatformId,
    guildId: string,
    warningMessageId: string,
  ) => Promise<void>;
  readonly updateCounterMessageId: (
    platform: PlatformId,
    guildId: string,
    counterMessageId: string,
  ) => Promise<void>;
  readonly updateCustomMessage: (
    platform: PlatformId,
    guildId: string,
    customMessage: string | undefined,
  ) => Promise<void>;
  readonly setLogChannelId: (
    platform: PlatformId,
    guildId: string,
    logChannelId: string | undefined,
  ) => Promise<boolean>;
  readonly incrementDetectionCount: (platform: PlatformId, guildId: string) => Promise<number>;
  readonly deleteConfig: (platform: PlatformId, guildId: string) => Promise<boolean>;
}

export interface HoneypotModule extends Disposable {
  readonly registerCommands: (registry: CommandRegistry) => void;
  readonly flushAllCaches: () => void;
}

export const HONEYPOT_MODULE_KEY = createServiceKey<HoneypotModule>('HoneypotModule');

export const HONEYPOT_SLASH_COMMANDS = [
  {
    name: 'honeypot',
    description: 'Configure and manage the server honeypot channel',
    options: [
      {
        type: 1,
        name: 'setup',
        description: 'Interactive 60s setup for the honeypot channel',
        options: [
          {
            type: 7,
            name: 'channel',
            description: 'Optional existing channel (defaults to creating #honeypot)',
            required: false,
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove the server honeypot configuration',
      },
      {
        type: 1,
        name: 'status',
        description: 'Show the current honeypot status and settings',
      },
      {
        type: 1,
        name: 'log',
        description: 'Set or reset the honeypot modlog channel',
        options: [
          {
            type: 3,
            name: 'target',
            description: 'Channel mention/ID or "off" to reset to guild default',
            required: true,
          },
        ],
      },
    ],
  },
] as const;

export {createMemoryHoneypotStore} from './_internal/memoryHoneypotStore';
export {createPgHoneypotStore} from './_internal/pgHoneypotStore';
