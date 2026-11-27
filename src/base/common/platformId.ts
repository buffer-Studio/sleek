export type PlatformId = 'discord' | 'fluxer';

export interface TenantKey {
  readonly platform: PlatformId;
  readonly guildId: string;
}

export function formatTenantKey(tenant: TenantKey): string {
  return `${tenant.platform}:${tenant.guildId}`;
}
