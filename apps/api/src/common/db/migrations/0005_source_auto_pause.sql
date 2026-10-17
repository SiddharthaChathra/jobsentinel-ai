ALTER TYPE "public"."source_status" ADD VALUE 'PAUSED_AUTO';--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "resumed_at" timestamp with time zone;