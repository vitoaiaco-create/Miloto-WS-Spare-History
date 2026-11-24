CREATE TABLE IF NOT EXISTS "ptt_diagnostic_sessions" (
	"id" serial PRIMARY KEY,
	"fleet_id" text NOT NULL,
	"truck_generation" text DEFAULT 'UNKNOWN' NOT NULL,
	"odometer_km" integer,
	"scan_batch_label" text,
	"workshop_context" text,
	"status" text DEFAULT 'SCANNED' NOT NULL,
	"overall_severity" text DEFAULT 'CLEAR' NOT NULL,
	"critical_count" integer DEFAULT 0 NOT NULL,
	"calibration_count" integer DEFAULT 0 NOT NULL,
	"monitor_count" integer DEFAULT 0 NOT NULL,
	"negligible_count" integer DEFAULT 0 NOT NULL,
	"spares_context_snapshot" jsonb,
	"ai_directive" jsonb,
	"verification_summary" jsonb,
	"verified_at" timestamp,
	"scanned_by" text,
	"scanned_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ptt_fault_codes" (
	"id" serial PRIMARY KEY,
	"session_id" integer NOT NULL,
	"fleet_id" text NOT NULL,
	"fault_code" text NOT NULL,
	"code_format" text DEFAULT 'OTHER' NOT NULL,
	"control_unit" text NOT NULL,
	"component_description" text NOT NULL,
	"fault_state" text DEFAULT 'UNKNOWN' NOT NULL,
	"occurrence_count" integer,
	"severity" text NOT NULL,
	"root_cause_summary" text NOT NULL,
	"calibration_required" boolean DEFAULT false NOT NULL,
	"resolved_on_rescan" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ptt_session_attachments" (
	"id" serial PRIMARY KEY,
	"session_id" integer NOT NULL,
	"role" text DEFAULT 'INITIAL_SCAN' NOT NULL,
	"file_name" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"blob_url" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'ptt_fault_codes_session_id_ptt_diagnostic_sessions_id_fkey'
	) THEN
		ALTER TABLE "ptt_fault_codes" ADD CONSTRAINT "ptt_fault_codes_session_id_ptt_diagnostic_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE CASCADE;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'ptt_session_attachments_LRar5jiihFGw_fkey'
	) THEN
		ALTER TABLE "ptt_session_attachments" ADD CONSTRAINT "ptt_session_attachments_LRar5jiihFGw_fkey" FOREIGN KEY ("session_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE CASCADE;
	END IF;
END $$;
