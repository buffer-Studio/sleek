import type {PlatformId} from '../../base/common/platformId';
import {isRegisteredPermissionNode, type PermissionNodeId} from '../auth/permissionNodeDictionary';
import type {ParsedCommandArgs} from '../parser/commandParser';

export interface CommandInvocationContext {
  readonly platform: PlatformId;
  readonly guildId: string | undefined;
  readonly channelId: string;
  readonly actorId: string;
  readonly actorRoleIds: readonly string[];
  readonly guildOwnerId: string | undefined;
  readonly rawArgs: string;
  readonly parsed: ParsedCommandArgs;
  readonly isSudo: boolean;
  readonly reply: (content: string) => Promise<void>;
}

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly moduleId: string;
  readonly permissionNode: PermissionNodeId;
  readonly description: string;
  readonly mutatesState: boolean;
  readonly adaptiveModeration?: boolean;
  readonly acceptsDuration?: boolean;
  readonly bypassAliasSovereign?: boolean;
  readonly execute: (ctx: CommandInvocationContext) => Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly aliases = new Map<string, string>();

  public register(def: CommandDefinition): void {
    const key = def.name.trim().toLowerCase();
    if (key.length === 0) {
      throw new Error('Command name cannot be empty.');
    }
    if (!isRegisteredPermissionNode(def.permissionNode)) {
      throw new Error(
        `I12 Registry Closure violation: command '${key}' references unregistered node '${String(def.permissionNode)}'.`,
      );
    }
    if (this.commands.has(key) || this.aliases.has(key)) {
      throw new Error(`Duplicate command registration: '${key}'.`);
    }
    this.commands.set(key, {...def, name: key});
    for (const rawAlias of def.aliases ?? []) {
      const aliasKey = rawAlias.trim().toLowerCase();
      if (aliasKey.length === 0 || aliasKey === key) {
        continue;
      }
      if (this.commands.has(aliasKey) || this.aliases.has(aliasKey)) {
        throw new Error(`Duplicate command alias registration: '${aliasKey}'.`);
      }
      this.aliases.set(aliasKey, key);
    }
  }

  public get(name: string): CommandDefinition | undefined {
    const key = name.trim().toLowerCase();
    const direct = this.commands.get(key);
    if (direct !== undefined) {
      return direct;
    }
    const canonical = this.aliases.get(key);
    return canonical !== undefined ? this.commands.get(canonical) : undefined;
  }

  public listNames(): ReadonlySet<string> {
    return new Set(this.commands.keys());
  }

  public all(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }
}
