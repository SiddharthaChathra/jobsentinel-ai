CREATE TYPE "public"."application_status" AS ENUM('VIEWED', 'APPLIED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'NOT_INTERESTED');--> statement-breakpoint
CREATE TYPE "public"."company_verification" AS ENUM('UNVERIFIED', 'VERIFIED', 'SUSPICIOUS', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('DISCOVERED', 'CLASSIFIED', 'FILTERED_OUT', 'VALIDATING', 'VALID', 'SUSPICIOUS', 'NEEDS_REVIEW', 'EXPIRED', 'REJECTED', 'MATCHED', 'AI_PENDING', 'NOTIFY_PENDING', 'NOTIFIED');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('DEBUG', 'INFO', 'WARN', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('TELEGRAM', 'WEB');--> statement-breakpoint
CREATE TYPE "public"."notification_mode" AS ENUM('INSTANT', 'DIGEST', 'BOTH', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('INSTANT', 'DIGEST', 'SYSTEM', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."priority_band" AS ENUM('VERY_HIGH', 'HIGH', 'MEDIUM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT');--> statement-breakpoint
CREATE TYPE "public"."scan_trigger" AS ENUM('SCHEDULED', 'MANUAL', 'RECOVERY');--> statement-breakpoint
CREATE TYPE "public"."source_priority" AS ENUM('HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('ACTIVE', 'DEGRADED', 'FAILING', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('ATS_API', 'PUBLIC_API', 'RSS', 'CAREER_PAGE');--> statement-breakpoint
CREATE TYPE "public"."url_status" AS ENUM('OK', 'REDIRECTED', 'NOT_FOUND', 'CLOSED', 'BLOCKED', 'TIMEOUT', 'ERROR', 'UNCHECKED');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('VALID', 'SUSPICIOUS', 'EXPIRED', 'INVALID', 'NEEDS_REVIEW', 'PENDING');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website_domain" text,
	"careers_url" text,
	"ats_provider" text,
	"ats_slug" text,
	"verification_status" "company_verification" DEFAULT 'UNVERIFIED' NOT NULL,
	"verification_confidence" numeric(3, 2),
	"verification_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"sources_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_normalized_name_unique" UNIQUE("normalized_name"),
	CONSTRAINT "companies_confidence_range" CHECK ("companies"."verification_confidence" is null or ("companies"."verification_confidence" between 0 and 1))
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "source_type" NOT NULL,
	"adapter" text NOT NULL,
	"base_url" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" "source_priority" DEFAULT 'NORMAL' NOT NULL,
	"scan_interval_sec" integer,
	"min_request_gap_ms" integer DEFAULT 1000 NOT NULL,
	"next_scan_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"manual_requested_at" timestamp with time zone,
	"last_attempted_scan" timestamp with time zone,
	"last_successful_scan" timestamp with time zone,
	"last_cursor" text,
	"last_seen_external_id" text,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"status" "source_status" DEFAULT 'ACTIVE' NOT NULL,
	"robots_checked_at" timestamp with time zone,
	"robots_allowed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "job_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"trigger" "scan_trigger" DEFAULT 'SCHEDULED' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" "scan_status" DEFAULT 'RUNNING' NOT NULL,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"jobs_found" integer DEFAULT 0 NOT NULL,
	"jobs_new" integer DEFAULT 0 NOT NULL,
	"jobs_updated" integer DEFAULT 0 NOT NULL,
	"jobs_skipped" integer DEFAULT 0 NOT NULL,
	"requests_made" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'VIEWED' NOT NULL,
	"applied_at" timestamp with time zone,
	"notes" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"overall_score" smallint NOT NULL,
	"skill_score" smallint NOT NULL,
	"role_score" smallint NOT NULL,
	"experience_score" smallint NOT NULL,
	"location_score" smallint NOT NULL,
	"priority" "priority_band" NOT NULL,
	"matched_skills" text[] DEFAULT '{}' NOT NULL,
	"missing_skills" text[] DEFAULT '{}' NOT NULL,
	"explanation" text,
	"ai_provider" text,
	"ai_model" text,
	"prompt_version" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_matches_score_range" CHECK ("job_matches"."overall_score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "job_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_source_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"raw_payload" jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_source_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_validation" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"status" "validation_status" DEFAULT 'PENDING' NOT NULL,
	"confidence" numeric(3, 2),
	"company_verified" boolean DEFAULT false NOT NULL,
	"application_verified" boolean DEFAULT false NOT NULL,
	"job_active" boolean DEFAULT true NOT NULL,
	"fresher_eligible" boolean,
	"original_url" text,
	"final_url" text,
	"http_status" smallint,
	"redirect_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url_status" "url_status" DEFAULT 'UNCHECKED' NOT NULL,
	"url_domain_relationship" text,
	"suspicious_flags" text[] DEFAULT '{}' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_assessment" jsonb,
	"review_note" text,
	"reviewed_by_user_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"validated_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_validation_confidence_range" CHECK ("job_validation"."confidence" is null or ("job_validation"."confidence" between 0 and 1))
);
--> statement-breakpoint
ALTER TABLE "job_validation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"role_family" text DEFAULT 'unknown' NOT NULL,
	"category" "job_category" DEFAULT 'UNKNOWN' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"description_html" text,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"location_text" text,
	"location_city" text,
	"location_country" text,
	"is_remote" boolean DEFAULT false NOT NULL,
	"employment_type" "employment_type" DEFAULT 'UNKNOWN' NOT NULL,
	"experience_text" text,
	"experience_min_years" numeric(3, 1),
	"experience_max_years" numeric(3, 1),
	"experience_level" "experience_level" DEFAULT 'UNKNOWN' NOT NULL,
	"fresher_eligible" boolean,
	"fresher_confidence" numeric(3, 2),
	"fresher_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"salary_min" numeric(14, 2),
	"salary_max" numeric(14, 2),
	"salary_currency" text,
	"salary_period" text,
	"salary_text" text,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone,
	"source_url" text NOT NULL,
	"application_url" text,
	"final_application_url" text,
	"dedupe_key" text NOT NULL,
	"description_simhash" bigint,
	"content_hash" text,
	"validation_status" "validation_status" DEFAULT 'PENDING' NOT NULL,
	"validation_confidence" numeric(3, 2),
	"status" "job_status" DEFAULT 'DISCOVERED' NOT NULL,
	"stage_error" text,
	"stage_attempts" integer DEFAULT 0 NOT NULL,
	"validated_at" timestamp with time zone,
	"matched_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_jobs" (
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_jobs_user_id_job_id_pk" PRIMARY KEY("user_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "saved_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mode" "notification_mode" DEFAULT 'BOTH' NOT NULL,
	"digest_hour_local" smallint DEFAULT 8 NOT NULL,
	"quiet_hours_start" smallint,
	"quiet_hours_end" smallint,
	"instant_min_score" smallint DEFAULT 75 NOT NULL,
	"include_needs_review_in_digest" boolean DEFAULT true NOT NULL,
	"telegram_enabled" boolean DEFAULT true NOT NULL,
	"paused_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"type" "notification_type" NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"digest_date" date,
	"send_after" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" bigint,
	"telegram_username" text,
	"link_code" text,
	"link_code_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_chat_id_unique" UNIQUE("chat_id"),
	CONSTRAINT "telegram_links_link_code_unique" UNIQUE("link_code")
);
--> statement-breakpoint
ALTER TABLE "telegram_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"job_id" uuid,
	"user_id" uuid,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "log_level" DEFAULT 'INFO' NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_id" uuid,
	"job_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_task" text,
	"once" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worker_heartbeats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_source_mappings" ADD CONSTRAINT "job_source_mappings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_source_mappings" ADD CONSTRAINT "job_source_mappings_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_validation" ADD CONSTRAINT "job_validation_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_domain_idx" ON "companies" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "job_sources_due_idx" ON "job_sources" USING btree ("next_scan_at") WHERE enabled = true;--> statement-breakpoint
CREATE INDEX "scan_runs_source_idx" ON "scan_runs" USING btree ("source_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_job_idx" ON "applications" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "job_matches_job_user_version_idx" ON "job_matches" USING btree ("job_id","user_id","profile_version");--> statement-breakpoint
CREATE INDEX "job_matches_user_score_idx" ON "job_matches" USING btree ("user_id","overall_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "job_matches_job_idx" ON "job_matches" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_source_mappings_source_external_idx" ON "job_source_mappings" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "job_source_mappings_job_idx" ON "job_source_mappings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_first_seen_idx" ON "jobs" USING btree ("first_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_posted_idx" ON "jobs" USING btree ("posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_category_fresher_idx" ON "jobs" USING btree ("category","fresher_eligible") WHERE status in ('VALID','MATCHED','NOTIFIED','NEEDS_REVIEW');--> statement-breakpoint
CREATE INDEX "jobs_dedupe_key_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_app_url_idx" ON "jobs" USING btree ("final_application_url");--> statement-breakpoint
CREATE INDEX "jobs_next_check_idx" ON "jobs" USING btree ("next_check_at") WHERE status in ('VALID','MATCHED','NOTIFIED');--> statement-breakpoint
CREATE INDEX "jobs_location_idx" ON "jobs" USING btree ("location_country","location_city");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_job_channel_type_idx" ON "notifications" USING btree ("user_id","job_id","channel","type") WHERE job_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_digest_once_idx" ON "notifications" USING btree ("user_id","channel","digest_date") WHERE type = 'DIGEST';--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "ai_calls_cache_idx" ON "ai_calls" USING btree ("purpose","prompt_version","input_hash");--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "system_logs_created_idx" ON "system_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "system_logs_category_idx" ON "system_logs" USING btree ("category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "companies_read" ON "companies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "job_sources_read" ON "job_sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "scan_runs_read" ON "scan_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "applications_owner" ON "applications" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "job_events_read" ON "job_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "job_matches_owner" ON "job_matches" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "job_source_mappings_read" ON "job_source_mappings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "job_validation_read" ON "job_validation" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "jobs_read" ON "jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "saved_jobs_owner" ON "saved_jobs" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notification_settings_owner" ON "notification_settings" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notifications_owner" ON "notifications" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "telegram_links_owner" ON "telegram_links" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
-- Hand-written: extensions and expression indexes drizzle-kit does not model (docs 02 §4).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING gin ("normalized_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_search_idx" ON "jobs" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '')));--> statement-breakpoint
-- updated_at maintenance for every table that has the column.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_set_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END;
$$;
