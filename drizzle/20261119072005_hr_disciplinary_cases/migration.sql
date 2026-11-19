CREATE TABLE IF NOT EXISTS "hr_disciplinary_attachments" (
	"id" serial PRIMARY KEY,
	"case_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"doc_label" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"blob_url" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hr_disciplinary_cases" (
	"id" serial PRIMARY KEY,
	"case_ref" text NOT NULL UNIQUE,
	"fleet_id" text NOT NULL,
	"employee_no" text NOT NULL,
	"driver_name" text NOT NULL,
	"status" text DEFAULT 'AWAITING_SIGNATURE' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"dispute_note" text,
	"document_payload" jsonb NOT NULL,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'hr_disciplinary_attachments_RyRiVJYKAu0R_fkey'
	) THEN
		ALTER TABLE "hr_disciplinary_attachments" ADD CONSTRAINT "hr_disciplinary_attachments_RyRiVJYKAu0R_fkey" FOREIGN KEY ("case_id") REFERENCES "hr_disciplinary_cases"("id") ON DELETE CASCADE;
	END IF;
END $$;