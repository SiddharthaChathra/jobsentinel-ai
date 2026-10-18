CREATE TYPE "public"."fresher_band" AS ENUM('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "company_fresher_stats" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"postings_seen" integer DEFAULT 0 NOT NULL,
	"fresher_count" integer DEFAULT 0 NOT NULL,
	"last_fresher_at" timestamp with time zone,
	"weighted_all" double precision DEFAULT 0 NOT NULL,
	"weighted_fresher" double precision DEFAULT 0 NOT NULL,
	"score" smallint,
	"band" "fresher_band" DEFAULT 'UNKNOWN' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_fresher_stats_score_range" CHECK ("company_fresher_stats"."score" is null or ("company_fresher_stats"."score" between 0 and 100))
);
--> statement-breakpoint
ALTER TABLE "company_fresher_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_fresher_stats" ADD CONSTRAINT "company_fresher_stats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "company_fresher_stats_read" ON "company_fresher_stats" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);