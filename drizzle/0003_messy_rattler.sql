ALTER TABLE "guild_honeypot_configs" ALTER COLUMN "action" SET DEFAULT 'softban';--> statement-breakpoint
ALTER TABLE "guild_honeypot_configs" ADD COLUMN "delete_message_seconds" integer DEFAULT 604800 NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_honeypot_configs" ADD COLUMN "dm_message" text;