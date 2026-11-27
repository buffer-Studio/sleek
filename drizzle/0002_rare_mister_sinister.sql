CREATE TABLE "guild_honeypot_configs" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"action" text DEFAULT 'ban' NOT NULL,
	"custom_message" text,
	"warning_message_id" text,
	"log_channel_id" text,
	"detection_count" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_honeypot_configs_platform_guild_id_pk" PRIMARY KEY("platform","guild_id")
);
