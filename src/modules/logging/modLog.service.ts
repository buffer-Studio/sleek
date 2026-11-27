import type {MessagingPort} from '../../core/ports/messaging.port';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';
import type {GovernanceService} from '../governance/governance.contract';
import type {ModLogEntry, ModLogService} from './modLog.contract';

export interface CreateModLogServiceOptions {
  readonly messagingPort: MessagingPort;
  readonly governance: GovernanceService;
  readonly logger: StructuredLogger;
}

export function createModLogService(options: CreateModLogServiceOptions): ModLogService {
  const {messagingPort, governance, logger} = options;

  return {
    logAction: async (entry: ModLogEntry): Promise<void> => {
      let targetChannelId = entry.channelId;
      if (targetChannelId === undefined) {
        const state = await governance.getGuildState(entry.platform, entry.guildId);
        targetChannelId = state.modlogChannelId;
      }

      logger.info('modlog.action', {
        platform: entry.platform,
        guildId: entry.guildId,
        module: entry.module,
        action: entry.action,
        targetUserId: entry.targetUserId,
        logChannelId: targetChannelId,
      });

      if (targetChannelId === undefined) {
        return;
      }

      const sanitizeMentions = (text: string): string =>
        text.replaceAll('@everyone', '@\u200beveryone').replaceAll('@here', '@\u200bhere');

      const lines = [
        `**[${entry.module.toUpperCase()}] ${entry.action.toUpperCase()}**`,
        `Target: <@${entry.targetUserId}> (\`${entry.targetUserId}\`)`,
        `Reason: ${sanitizeMentions(entry.reason)}`,
      ];
      if (entry.details !== undefined && entry.details.length > 0) {
        lines.push(sanitizeMentions(entry.details));
      }

      const res = await messagingPort.sendMessage({
        platform: entry.platform,
        channelId: targetChannelId,
        content: lines.join('\n'),
      });
      if (!res.ok) {
        logger.warn('modlog.send_failed', {
          platform: entry.platform,
          guildId: entry.guildId,
          channelId: targetChannelId,
          code: res.error.code,
          message: res.error.message,
        });
      }
    },
  };
}
