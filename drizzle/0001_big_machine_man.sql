CREATE TABLE "scheduled_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"dedupe_key" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_scheduled_jobs_pending_run_at" ON "scheduled_jobs" USING btree ("run_at") WHERE "scheduled_jobs"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_scheduled_jobs_active_dedupe" ON "scheduled_jobs" USING btree ("dedupe_key") WHERE "scheduled_jobs"."status" IN ('pending', 'processing') AND "scheduled_jobs"."dedupe_key" IS NOT NULL;