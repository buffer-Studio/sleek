import type {PlatformId} from '../../../base/common/platformId';
import type {HoneypotConfig, HoneypotStore, UpsertHoneypotConfigInput} from '../honeypot.contract';

export function createMemoryHoneypotStore(): HoneypotStore {
  const configs = new Map<string, HoneypotConfig>();

  function key(platform: PlatformId, guildId: string): string {
    return `${platform}:${guildId}`;
  }

  return {
    getConfig: async (platform, guildId) => {
      await Promise.resolve();
      return configs.get(key(platform, guildId));
    },

    upsertConfig: async (input: UpsertHoneypotConfigInput) => {
      await Promise.resolve();
      const k = key(input.platform, input.guildId);
      const existing = configs.get(k);
      const next: HoneypotConfig = {
        platform: input.platform,
        guildId: input.guildId,
        channelId: input.channelId,
        action: input.action,
        deleteMessageSeconds: input.deleteMessageSeconds,
        customMessage: input.customMessage,
        dmMessage: input.dmMessage,
        warningMessageId: input.warningMessageId ?? existing?.warningMessageId,
        counterMessageId: input.counterMessageId ?? existing?.counterMessageId,
        logChannelId: input.logChannelId ?? existing?.logChannelId,
        detectionCount: existing?.detectionCount ?? 0,
        enabled: input.enabled ?? existing?.enabled ?? true,
        updatedAtMs: Date.now(),
      };
      configs.set(k, next);
      return next;
    },

    updateWarningMessageId: async (platform, guildId, warningMessageId) => {
      await Promise.resolve();
      const k = key(platform, guildId);
      const existing = configs.get(k);
      if (existing !== undefined) {
        configs.set(k, {...existing, warningMessageId, updatedAtMs: Date.now()});
      }
    },

    updateCounterMessageId: async (platform, guildId, counterMessageId) => {
      await Promise.resolve();
      const k = key(platform, guildId);
      const existing = configs.get(k);
      if (existing !== undefined) {
        configs.set(k, {...existing, counterMessageId, updatedAtMs: Date.now()});
      }
    },

    updateCustomMessage: async (platform, guildId, customMessage) => {
      await Promise.resolve();
      const k = key(platform, guildId);
      const existing = configs.get(k);
      if (existing !== undefined) {
        configs.set(k, {...existing, customMessage, updatedAtMs: Date.now()});
      }
    },

    setLogChannelId: async (platform, guildId, logChannelId) => {
      await Promise.resolve();
      const k = key(platform, guildId);
      const existing = configs.get(k);
      if (existing === undefined) {
        return false;
      }
      configs.set(k, {...existing, logChannelId, updatedAtMs: Date.now()});
      return true;
    },

    incrementDetectionCount: async (platform, guildId) => {
      await Promise.resolve();
      const k = key(platform, guildId);
      const existing = configs.get(k);
      if (existing === undefined) {
        return 0;
      }
      const nextCount = existing.detectionCount + 1;
      configs.set(k, {...existing, detectionCount: nextCount, updatedAtMs: Date.now()});
      return nextCount;
    },

    getGlobalDetectionCount: async () => {
      await Promise.resolve();
      let total = 0;
      for (const config of configs.values()) {
        total += config.detectionCount;
      }
      return total;
    },

    deleteConfig: async (platform, guildId) => {
      await Promise.resolve();
      return configs.delete(key(platform, guildId));
    },
  };
}
