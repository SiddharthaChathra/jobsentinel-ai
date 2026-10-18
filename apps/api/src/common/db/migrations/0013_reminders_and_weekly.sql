CREATE TYPE "public"."reminder_kind" AS ENUM('FOLLOW_UP', 'INTERVIEW_DAY_BEFORE', 'INTERVIEW_MORNING', 'DEADLINE_3D', 'DEADLINE_1D');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('PENDING', 'SENT', 'DISMISSED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'REMINDER';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'WEEKLY';--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"anchor" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"snoozed_until" timestamp with time zone,
	"status" "reminder_status" DEFAULT 'PENDING' NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "interview_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "last_status_change_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "follow_up_days" smallint DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "weekly_summary_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("due_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dated_once_idx" ON "notifications" USING btree ("user_id","channel","type","digest_date") WHERE digest_date is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reminder_once_idx" ON "notifications" USING btree ("user_id","channel",(payload->>'reminderId'),(payload->>'delivery')) WHERE (payload->>'reminderId') is not null;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_follow_up_days" CHECK ("notification_settings"."follow_up_days" between 3 and 14);--> statement-breakpoint
CREATE POLICY "reminders_owner" ON "reminders" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
-- Existing tracker rows: their last status change is unknown; their last update is the closest record (F5, D119).
UPDATE "applications" SET "last_status_change_at" = "updated_at" WHERE "last_status_change_at" IS NULL;
