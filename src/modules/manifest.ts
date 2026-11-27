import type {PlatformId} from '../base/common/platformId';
import {CommandRegistry} from '../core/commands/commandRegistry';
import type {EventBus} from '../core/events/eventBus';
import type {GuildHierarchyCache} from '../core/hierarchy/guildHierarchyCache';
import type {ChannelPort} from '../core/ports/channel.port';
import type {InteractionPort} from '../core/ports/interaction.port';
import type {MessagingPort} from '../core/ports/messaging.port';
import type {ModerationPort} from '../core/ports/moderation.port';
import type {RolePort} from '../core/ports/role.port';
import type {ValkeyClient} from '../platform/cache/valkeyClient';
import type {SleekConfigStore} from '../platform/config/sleekConfig';
import type {DatabaseClient} from '../platform/database/drizzleClient';
import type {ServiceRegistry} from '../platform/di/serviceRegistry';
import type {StructuredLogger} from '../platform/logger/structuredLogger';
import type {QueuePort} from '../platform/queue/queue.port';
import {createDeveloperModule, DEVELOPER_MODULE_KEY} from './developer/developer.module';
import {GOVERNANCE_SERVICE_KEY, type GovernanceStore} from './governance/governance.contract';
import {createGovernanceService} from './governance/governance.service';
import {
  createMemoryHoneypotStore,
  createPgHoneypotStore,
  HONEYPOT_MODULE_KEY,
  type HoneypotStore,
} from './honeypot/honeypot.contract';
import {createHoneypotModule} from './honeypot/honeypot.module';
import {MOD_LOG_SERVICE_KEY} from './logging/modLog.contract';
import {createModLogService} from './logging/modLog.service';
import {SECURITY_SERVICE_KEY, type SecurityStore} from './security/security.contract';
import {createSecurityService} from './security/security.service';

export interface RegisterCoreModulesOptions {
  readonly registry: ServiceRegistry;
  readonly securityStore: SecurityStore;
  readonly governanceStore: GovernanceStore;
  readonly honeypotStore?: HoneypotStore;
  readonly valkey: ValkeyClient;
  readonly database: DatabaseClient | undefined;
  readonly configStore: SleekConfigStore;
  readonly botOwnersByPlatform: Readonly<Record<PlatformId, ReadonlySet<string>>>;
  readonly rolePort: RolePort;
  readonly messagingPort: MessagingPort;
  readonly moderationPort?: ModerationPort;
  readonly channelPort?: ChannelPort;
  readonly interactionPort?: InteractionPort;
  readonly eventBus?: EventBus;
  readonly queuePort?: QueuePort;
  readonly hierarchyCache?: GuildHierarchyCache;
  readonly logger: StructuredLogger;
}

export function registerCoreModules(options: RegisterCoreModulesOptions): CommandRegistry {
  const commandRegistry = new CommandRegistry();

  const security = createSecurityService({
    store: options.securityStore,
    valkey: options.valkey,
    configStore: options.configStore,
    botOwnersByPlatform: options.botOwnersByPlatform,
    rolePort: options.rolePort,
    logger: options.logger,
  });

  const governance = createGovernanceService({
    store: options.governanceStore,
    valkey: options.valkey,
    configStore: options.configStore,
  });

  const developer = createDeveloperModule({
    security,
    governance,
    database: options.database,
    valkey: options.valkey,
    configStore: options.configStore,
    rolePort: options.rolePort,
    messagingPort: options.messagingPort,
    registry: commandRegistry,
  });

  const modLog = createModLogService({
    messagingPort: options.messagingPort,
    governance,
    logger: options.logger,
  });

  security.registerCommands(commandRegistry);
  governance.registerCommands(commandRegistry);
  developer.registerCommands(commandRegistry);

  options.registry.register(SECURITY_SERVICE_KEY, security);
  options.registry.register(GOVERNANCE_SERVICE_KEY, governance);
  options.registry.register(DEVELOPER_MODULE_KEY, developer);
  options.registry.register(MOD_LOG_SERVICE_KEY, modLog);

  if (
    options.channelPort !== undefined &&
    options.moderationPort !== undefined &&
    options.eventBus !== undefined
  ) {
    const honeypotStore =
      options.honeypotStore ??
      (options.database !== undefined
        ? createPgHoneypotStore(options.database)
        : createMemoryHoneypotStore());
    const honeypot = createHoneypotModule({
      store: honeypotStore,
      security,
      modLog,
      channelPort: options.channelPort,
      messagingPort: options.messagingPort,
      moderationPort: options.moderationPort,
      eventBus: options.eventBus,
      hierarchyCache: options.hierarchyCache,
      logger: options.logger,
    });
    honeypot.registerCommands(commandRegistry);
    options.registry.register(HONEYPOT_MODULE_KEY, honeypot);
  }

  return commandRegistry;
}
