CREATE TYPE "public"."employment_type" AS ENUM('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'TRAINEE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('FRESHER', 'ENTRY_LEVEL', 'EXPERIENCED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."job_category" AS ENUM('SOFTWARE', 'IT_SUPPORT', 'NETWORK', 'CLOUD_DEVOPS', 'DATA', 'ELECTRICAL_ELECTRONICS', 'MECHANICAL', 'CIVIL', 'OTHER_ENGINEERING', 'NON_ENGINEERING', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."remote_preference" AS ENUM('ANY', 'REMOTE_ONLY', 'ONSITE_ONLY', 'HYBRID_OK');--> statement-breakpoint
CREATE TYPE "public"."resume_parse_status" AS ENUM('UPLOADED', 'PARSED', 'ANALYZED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."role_tier" AS ENUM('PRIMARY', 'SECONDARY', 'OTHER');--> statement-breakpoint
CREATE TABLE "preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locations" text[] DEFAULT '{"India","Remote"}' NOT NULL,
	"remote_preference" "remote_preference" DEFAULT 'ANY' NOT NULL,
	"employment_types" "employment_type"[] DEFAULT '{"FULL_TIME","INTERNSHIP","TRAINEE"}' NOT NULL,
	"categories" "job_category"[] DEFAULT '{"SOFTWARE","IT_SUPPORT","NETWORK","CLOUD_DEVOPS","DATA"}' NOT NULL,
	"fresher_only" boolean DEFAULT true NOT NULL,
	"include_unknown_experience" boolean DEFAULT true NOT NULL,
	"salary_min" integer,
	"salary_currency" text DEFAULT 'INR' NOT NULL,
	"graduation_year" smallint,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"instant_min_score" smallint DEFAULT 75 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "preferred_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"role_family" text DEFAULT 'unknown' NOT NULL,
	"tier" "role_tier" DEFAULT 'PRIMARY' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preferred_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"profile_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"proficiency" text,
	"origin" text DEFAULT 'RESUME' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_skills_profile_id_skill_id_pk" PRIMARY KEY("profile_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "profile_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_resume_id" uuid,
	"experience_level" "experience_level" DEFAULT 'FRESHER' NOT NULL,
	"graduation_year" smallint,
	"degree" text,
	"branch" text,
	"college" text,
	"location_text" text,
	"summary" text,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"parse_status" "resume_parse_status" DEFAULT 'UPLOADED' NOT NULL,
	"extracted_text" text,
	"ai_analysis" jsonb,
	"ai_provider" text,
	"ai_model" text,
	"prompt_version" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parsed_at" timestamp with time zone,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resumes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"profile_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferred_roles" ADD CONSTRAINT "preferred_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preferred_roles_user_title_idx" ON "preferred_roles" USING btree ("user_id","normalized_title");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_one_active_idx" ON "resumes" USING btree ("user_id") WHERE is_active = true;--> statement-breakpoint
CREATE POLICY "preferences_owner" ON "preferences" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "preferred_roles_owner" ON "preferred_roles" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profile_skills_owner" ON "profile_skills" AS PERMISSIVE FOR ALL TO "authenticated" USING (profile_id in (select id from profiles where user_id = (select auth.uid()))) WITH CHECK (profile_id in (select id from profiles where user_id = (select auth.uid())));--> statement-breakpoint
CREATE POLICY "profiles_owner" ON "profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "resumes_owner" ON "resumes" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "skills_read" ON "skills" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "users_owner" ON "users" AS PERMISSIVE FOR ALL TO "authenticated" USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));--> statement-breakpoint
-- Hand-written: link app users to Supabase Auth (managed schema, never created by us).
ALTER TABLE "users" ADD CONSTRAINT "users_id_auth_users_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade;
