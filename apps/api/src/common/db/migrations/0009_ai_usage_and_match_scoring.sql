CREATE TYPE "public"."match_scoring" AS ENUM('RULES_ONLY', 'AI_REFINED');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_date" date NOT NULL,
	"user_id" uuid,
	"provider" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_day_user_provider" UNIQUE NULLS NOT DISTINCT("usage_date","user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "scoring" "match_scoring" DEFAULT 'RULES_ONLY' NOT NULL;--> statement-breakpoint
-- Backfill (D112): rows the AI already refined say so, and the budget starts from the calls
-- already made (ai_calls keeps 60 days), so today's limit is not reset by the deploy.
UPDATE "job_matches" SET "scoring" = 'AI_REFINED' WHERE "ai_provider" IS NOT NULL;--> statement-breakpoint
INSERT INTO "ai_usage" ("usage_date", "user_id", "provider", "calls", "tokens")
SELECT ("created_at" AT TIME ZONE 'UTC')::date, "user_id", "provider",
  count(*)::int, coalesce(sum("input_tokens" + "output_tokens"), 0)::int
FROM "ai_calls"
WHERE "status" NOT IN ('BUDGET_EXCEEDED', 'UNAVAILABLE')
GROUP BY 1, 2, 3;
