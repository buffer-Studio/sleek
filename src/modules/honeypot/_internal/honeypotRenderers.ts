import type {PlatformId} from '../../../base/common/platformId';
import {parseDurationMs} from '../../../core/parser/durationParser';
import type {HoneypotAction} from '../schema/honeypot.table';

export const CHANNEL_TOPIC_MAX_LENGTH = 1024;
export const DM_MESSAGE_MAX_LENGTH = 1500;
export const DEFAULT_BAN_DELETE_SECONDS = 604_800;
export const MAX_BAN_DELETE_SECONDS = 604_800;

export const HONEYPOT_EVERYONE_ALLOW_BITS = String(
  (1n << 10n) | // VIEW_CHANNEL
    (1n << 11n) | // SEND_MESSAGES
    (1n << 14n) | // EMBED_LINKS
    (1n << 15n) | // ATTACH_FILES
    (1n << 16n) | // READ_MESSAGE_HISTORY
    (1n << 18n) | // USE_EXTERNAL_EMOJIS
    (1n << 37n), // USE_EXTERNAL_STICKERS
);

export const HONEYPOT_EVERYONE_DENY_BITS = String(
  (1n << 0n) | // CREATE_INSTANT_INVITE
    (1n << 4n) | // MANAGE_CHANNELS
    (1n << 6n) | // ADD_REACTIONS
    (1n << 12n) | // SEND_TTS_MESSAGES
    (1n << 13n) | // MANAGE_MESSAGES
    (1n << 17n) | // MENTION_EVERYONE
    (1n << 28n) | // MANAGE_ROLES
    (1n << 29n) | // MANAGE_WEBHOOKS
    (1n << 31n) | // USE_APPLICATION_COMMANDS
    (1n << 34n) | // MANAGE_THREADS
    (1n << 35n) | // CREATE_PUBLIC_THREADS
    (1n << 36n) | // CREATE_PRIVATE_THREADS
    (1n << 38n) | // SEND_MESSAGES_IN_THREADS
    (1n << 46n) | // SEND_VOICE_MESSAGES
    (1n << 49n) | // SEND_POLLS
    (1n << 50n) | // USE_EXTERNAL_APPS
    (1n << 51n) | // PIN_MESSAGES
    (1n << 52n), // BYPASS_SLOWMODE
);

const DEFAULT_HONEYPOT_TEMPLATE = [
  '# DO NOT SEND A MESSAGE HERE',
  '**🇺🇸 / 🇬🇧 :** This channel is meant to catch hacked Discord accounts and notify them. Sending a message here will ban you from the server.',
  '',
  '**🇮🇳 :** यह चैनल हैक किए गए Discord खातों का पता लगाने और उन्हें सूचित करने के लिए है। यहाँ संदेश भेजने पर आपको सर्वर से {$action} कर दिया जाएगा।',
  '-# Yeh channel hack hue Discord accounts ka pata lagane aur unhe batane ke liye hai. Yahan message karne se aapko server se ban kardiya jayega.',
  '',
  "**🇫🇷 :** Ce canal a pour but de repérer les comptes Discord piratés et d'en informer leurs propriétaires. Si vous envoyez un message ici, vous serez banni du serveur.",
  '',
  '**🇪🇸 / 🇲🇽 :** Este canal está destinado a detectar cuentas de Discord pirateadas y notificárselo a sus titulares. Si envías un mensaje aquí, se te expulsará del servidor.',
  '',
  '**🇩🇪 :** Dieser Kanal dient dazu, gehackte Discord-Konten aufzuspüren und die Betroffenen zu benachrichtigen. Wenn du hier eine Nachricht sendest, wirst du vom Server ausgeschlossen.',
].join('\n');

export function parseChannelMentionOrId(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(?:<#(\d{17,20})>|(\d{17,20}))$/.exec(raw.trim());
  return match?.[1] ?? match?.[2];
}

export function parseDeleteDurationSeconds(raw: string): number | undefined {
  const lower = raw.trim().toLowerCase();
  if (lower === '0' || lower === '0s' || lower === 'none') {
    return 0;
  }
  const ms = parseDurationMs(lower);
  if (ms === undefined) {
    return undefined;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 0 || seconds > MAX_BAN_DELETE_SECONDS) {
    return undefined;
  }
  return seconds;
}

export function formatInviteUrl(_platform: PlatformId, code: string): string {
  return `https://discord.gg/${code}`;
}

export function parseInviteUrlOrCode(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'skip') {
    return undefined;
  }
  const match =
    /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/i.exec(
      trimmed,
    ) ?? /^([A-Za-z0-9-]{2,32})$/.exec(trimmed);
  const code = match?.[1];
  return code !== undefined ? formatInviteUrl('discord', code) : undefined;
}

export function renderHoneypotMessage(options: {
  readonly platform: PlatformId;
  readonly action: HoneypotAction;
  readonly detectionCount: number;
  readonly customMessage: string | undefined;
}): string {
  const template = options.customMessage ?? DEFAULT_HONEYPOT_TEMPLATE;
  const actionLabel = 'kick';
  return template
    .replaceAll('{$platform}', 'Discord')
    .replaceAll('{$action}', actionLabel)
    .replaceAll('{$detection_count}', String(options.detectionCount));
}

export function renderHoneypotWarningComponents(
  serverCount: number,
  globalCount: number,
): readonly unknown[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: `Detected: ${serverCount}`,
          disabled: true,
          custom_id: 'honeypot_server_count',
        },
        {
          type: 2,
          style: 2,
          label: `Globally: ${globalCount}`,
          disabled: true,
          custom_id: 'honeypot_global_count',
        },
      ],
    },
  ];
}

export function renderHoneypotDmMessage(options: {
  readonly communityName: string;
  readonly inviteUrl: string | undefined;
  readonly customDmMessage: string | undefined;
}): string {
  if (options.customDmMessage === undefined) {
    const base = `We suspect your account has been compromised, so you have been removed from ${options.communityName}.`;
    return options.inviteUrl !== undefined
      ? `${base}\nYou can rejoin using: ${options.inviteUrl}`
      : base;
  }
  const hasInvitePlaceholder = options.customDmMessage.includes('{$inviteUrl}');
  const rendered = options.customDmMessage
    .replaceAll('{$action}', 'kick')
    .replaceAll('{$communityName}', options.communityName)
    .replaceAll('{$inviteUrl}', options.inviteUrl ?? '');
  if (!hasInvitePlaceholder && options.inviteUrl !== undefined) {
    return `${rendered}\nYou can rejoin using: ${options.inviteUrl}`;
  }
  return rendered;
}

export function clampTopic(text: string): string {
  return text.length <= CHANNEL_TOPIC_MAX_LENGTH ? text : text.slice(0, CHANNEL_TOPIC_MAX_LENGTH);
}

export function normalizeText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim();
}

export function sanitizeSnippet(content: string): string {
  return content
    .slice(0, 200)
    .replaceAll('`', '')
    .replaceAll('@everyone', '@\u200beveryone')
    .replaceAll('@here', '@\u200bhere');
}

export function renderHoneypotDmComponents(options: {
  readonly guildName: string;
  readonly guildId: string;
  readonly channelName: string;
  readonly channelLink: string;
  readonly durationLabel: string;
  readonly inviteUrl: string;
  readonly supportServerUrl: string;
}): readonly unknown[] {
  return [
    {
      type: 17,
      accent_color: null,
      spoiler: false,
      components: [
        {type: 10, content: '## Automated Security Action'},
        {type: 14, divider: true, spacing: 1},
        {
          type: 10,
          content: `You were removed from **${options.guildName}** after posting in a honeypot channel ([#${options.channelName}](${options.channelLink})).`,
        },
        {
          type: 10,
          content: `**Why this happened❓**\n> -# Honeypot channels stay off-limits to catch compromised accounts and spam bots. Messages from the past ${options.durationLabel} were deleted to protect the server.`,
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: `From: ${options.guildName} (${options.guildId})`,
              emoji: null,
              disabled: true,
              custom_id: '818a1544980f45abc654c921354a469e',
            },
          ],
        },
      ],
    },
    {
      type: 17,
      accent_color: null,
      spoiler: false,
      components: [
        {type: 14, divider: true, spacing: 1},
        {
          type: 10,
          content:
            '**What to do if your account was compromised❓**\n> 1. Change your Discord password right away to log out active attacker sessions.\n> 2. Turn on Two-Factor Authentication (2FA) in User Settings.\n> 3. Open Authorized Apps (`Settings → Authorized Apps`) and remove apps you do not recognize.',
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Stay Safe!',
              emoji: null,
              disabled: false,
              url: options.inviteUrl,
            },
            {
              type: 2,
              style: 5,
              label: 'From Developers :)',
              emoji: null,
              disabled: false,
              url: options.supportServerUrl,
            },
          ],
        },
        {type: 14, divider: true, spacing: 1},
      ],
    },
    {
      type: 17,
      accent_color: null,
      spoiler: false,
      components: [
        {
          type: 10,
          content: `**Note:** A softban bans and immediately unbans you, so you are not permanently blocked. Once your account is secure, rejoin with this invite: ${options.inviteUrl}`,
        },
      ],
    },
  ];
}
