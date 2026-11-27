import type {PlatformId} from '../../base/common/platformId';
import {createServiceKey} from '../../platform/di/serviceKey';

export interface ModLogEntry {
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly channelId?: string;
  readonly module: string;
  readonly action: string;
  readonly targetUserId: string;
  readonly reason: string;
  readonly details?: string;
}

export interface ModLogService {
  readonly logAction: (entry: ModLogEntry) => Promise<void>;
}

export const MOD_LOG_SERVICE_KEY = createServiceKey<ModLogService>('ModLogService');
