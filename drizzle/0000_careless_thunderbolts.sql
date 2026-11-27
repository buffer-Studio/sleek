CREATE TABLE "bot_voters" (
	"platform" text NOT NULL,
	"user_id" text NOT NULL,
	"last_voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vote_expires_at" timestamp with time zone NOT NULL,
	"current_streak" integer DEFAULT 1 NOT NULL,
	"longest_streak" integer DEFAULT 1 NOT NULL,
	"total_votes" integer DEFAULT 1 NOT NULL,
	"is_donator" boolean DEFAULT false NOT NULL,
	"donator_expires_at" timestamp with time zone,
	CONSTRAINT "bot_voters_platform_user_id_pk" PRIMARY KEY("platform","user_id")
);
--> statement-breakpoint
CREATE TABLE "guild_command_aliases" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"shortcut" text NOT NULL,
	"target_command" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "guild_command_aliases_platform_guild_id_shortcut_pk" PRIMARY KEY("platform","guild_id","shortcut")
);
--> statement-breakpoint
CREATE TABLE "guild_disabled_commands" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"command_name" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"disabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_by" text NOT NULL,
	CONSTRAINT "guild_disabled_commands_platform_guild_id_command_name_scope_type_scope_id_pk" PRIMARY KEY("platform","guild_id","command_name","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "guild_disabled_modules" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"module_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"disabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_by" text NOT NULL,
	CONSTRAINT "guild_disabled_modules_platform_guild_id_module_id_scope_type_scope_id_pk" PRIMARY KEY("platform","guild_id","module_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "guild_ignored_targets" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "guild_ignored_targets_platform_guild_id_target_type_target_id_pk" PRIMARY KEY("platform","guild_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"prefix" text DEFAULT ',' NOT NULL,
	"fallback_comma_disabled" boolean DEFAULT false NOT NULL,
	"modlog_channel_id" text,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"frozen_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_settings_platform_guild_id_pk" PRIMARY KEY("platform","guild_id")
);
--> statement-breakpoint
CREATE TABLE "topgg_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"user_id" text NOT NULL,
	"external_vote_id" text NOT NULL,
	"vote_type" text NOT NULL,
	"is_weekend" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_command_aliases" (
	"platform" text NOT NULL,
	"user_id" text NOT NULL,
	"shortcut" text NOT NULL,
	"target_command" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_command_aliases_platform_user_id_shortcut_pk" PRIMARY KEY("platform","user_id","shortcut")
);
--> statement-breakpoint
CREATE TABLE "user_personal_prefixes" (
	"platform" text NOT NULL,
	"user_id" text NOT NULL,
	"prefix" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_personal_prefixes_platform_user_id_pk" PRIMARY KEY("platform","user_id")
);
--> statement-breakpoint
CREATE TABLE "acting_owner_ledger" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"action_type" text NOT NULL,
	"inverse_action" text,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "acting_owner_ledger_platform_guild_id_id_pk" PRIMARY KEY("platform","guild_id","id")
);
--> statement-breakpoint
CREATE TABLE "guild_acting_owner" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"granted_nodes" text[] DEFAULT '{"*"}' NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"session_id" text NOT NULL,
	"burst_limit" integer DEFAULT 15 NOT NULL,
	"burst_window_seconds" integer DEFAULT 60 NOT NULL,
	"sustained_limit" integer DEFAULT 40 NOT NULL,
	"sustained_window_seconds" integer DEFAULT 3600 NOT NULL,
	"is_complete_trust" boolean DEFAULT false NOT NULL,
	"is_rolling" boolean DEFAULT false NOT NULL,
	"trust_expires_at" timestamp with time zone,
	"last_attested_at" timestamp with time zone,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "guild_acting_owner_platform_guild_id_pk" PRIMARY KEY("platform","guild_id")
);
--> statement-breakpoint
CREATE TABLE "guild_fake_permissions" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"target_id" text NOT NULL,
	"is_role" boolean DEFAULT true NOT NULL,
	"node" text NOT NULL,
	"expires_at" timestamp with time zone,
	"channel_scope" text[],
	"approvals_required" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "guild_fake_permissions_platform_guild_id_target_id_node_pk" PRIMARY KEY("platform","guild_id","target_id","node")
);
--> statement-breakpoint
CREATE TABLE "guild_permission_epochs" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"epoch" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_permission_epochs_platform_guild_id_pk" PRIMARY KEY("platform","guild_id")
);
--> statement-breakpoint
CREATE TABLE "guild_role_quotas" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"action_node" text NOT NULL,
	"limit_count" integer NOT NULL,
	"window_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "guild_role_quotas_platform_guild_id_role_id_action_node_pk" PRIMARY KEY("platform","guild_id","role_id","action_node")
);
--> statement-breakpoint
CREATE TABLE "guild_staff_roles" (
	"platform" text NOT NULL,
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"tier" text DEFAULT 'staff' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "guild_staff_roles_platform_guild_id_role_id_pk" PRIMARY KEY("platform","guild_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"executor_id" text NOT NULL,
	"target_guild_id" text NOT NULL,
	"command_executed" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"platform" text NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"granted_nodes" text[] DEFAULT '{}' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "platform_staff_platform_user_id_pk" PRIMARY KEY("platform","user_id")
);
--> statement-breakpoint
CREATE INDEX "idx_bot_voters_expiry" ON "bot_voters" USING btree ("platform","user_id","vote_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topgg_votes_idempotency" ON "topgg_votes" USING btree ("platform","user_id","external_vote_id");--> statement-breakpoint
CREATE INDEX "idx_acting_owner_ledger_session" ON "acting_owner_ledger" USING btree ("platform","guild_id","session_id");--> statement-breakpoint
CREATE INDEX "idx_guild_fake_perms_lookup" ON "guild_fake_permissions" USING btree ("platform","guild_id","target_id");--> statement-breakpoint
CREATE INDEX "idx_guild_staff_roles_tier" ON "guild_staff_roles" USING btree ("platform","guild_id","tier");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_guild" ON "platform_audit_logs" USING btree ("platform","target_guild_id","executed_at");