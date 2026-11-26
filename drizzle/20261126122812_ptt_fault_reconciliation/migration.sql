CREATE TABLE "ptt_approved_exceptions" (
	"id" serial PRIMARY KEY,
	"scope" text NOT NULL,
	"generation" text,
	"fleet_id" text,
	"canonical_key" text NOT NULL,
	"reason_category" text NOT NULL,
	"physical_proof_note" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ptt_approved_exceptions_scope_target" CHECK (("scope" = 'FLEET_GENERATION' and "generation" is not null and "fleet_id" is null) or ("scope" = 'TRUCK_SPECIFIC' and "fleet_id" is not null)),
	CONSTRAINT "ptt_approved_exceptions_proof_note_not_blank" CHECK (length(btrim("physical_proof_note")) > 0)
);
--> statement-breakpoint
CREATE TABLE "ptt_scan_faults" (
	"id" serial PRIMARY KEY,
	"scan_id" integer NOT NULL,
	"canonical_key" text NOT NULL,
	"ecu_label" text NOT NULL,
	"dtc_raw" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"ptt_status" text NOT NULL,
	"severity" text NOT NULL,
	"reconciliation_bucket" text,
	"is_bounce_back" boolean DEFAULT false NOT NULL,
	"is_approved_exception" boolean DEFAULT false NOT NULL,
	"is_extracted" boolean DEFAULT true NOT NULL,
	"key_needs_review" boolean DEFAULT false NOT NULL,
	"key_review_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ptt_truck_fault_ledger" (
	"id" serial PRIMARY KEY,
	"fleet_id" text NOT NULL,
	"canonical_key" text NOT NULL,
	"ecu_label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"latest_severity" text NOT NULL,
	"ledger_status" text NOT NULL,
	"first_seen_scan_id" integer,
	"last_seen_scan_id" integer,
	"cleared_scan_id" integer,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"cleared_at" timestamp,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"last_reopened_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "case_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "scan_role" text DEFAULT 'BASELINE' NOT NULL;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "parent_scan_id" integer;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "header_item_count" integer;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "extracted_item_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "is_complete_scan" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "chassis_id_ocr" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "work_order_ocr" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "product_time_ocr" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "image_hashes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "case_status" text DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "reconciliation_summary" jsonb;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "gate_overrides" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ptt_approved_exceptions_generation_key_idx" ON "ptt_approved_exceptions" ("generation","canonical_key") WHERE "scope" = 'FLEET_GENERATION' and "is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "ptt_approved_exceptions_fleet_key_idx" ON "ptt_approved_exceptions" ("fleet_id","canonical_key") WHERE "scope" = 'TRUCK_SPECIFIC' and "is_active";--> statement-breakpoint
CREATE INDEX "ptt_approved_exceptions_key_idx" ON "ptt_approved_exceptions" ("canonical_key");--> statement-breakpoint
CREATE INDEX "ptt_diagnostic_sessions_case_id_idx" ON "ptt_diagnostic_sessions" ("case_id");--> statement-breakpoint
CREATE INDEX "ptt_diagnostic_sessions_fleet_id_idx" ON "ptt_diagnostic_sessions" ("fleet_id");--> statement-breakpoint
CREATE INDEX "ptt_diagnostic_sessions_parent_scan_id_idx" ON "ptt_diagnostic_sessions" ("parent_scan_id");--> statement-breakpoint
CREATE INDEX "ptt_diagnostic_sessions_image_hashes_idx" ON "ptt_diagnostic_sessions" USING gin ("image_hashes");--> statement-breakpoint
CREATE UNIQUE INDEX "ptt_scan_faults_scan_id_canonical_key_idx" ON "ptt_scan_faults" ("scan_id","canonical_key");--> statement-breakpoint
CREATE INDEX "ptt_scan_faults_bucket_idx" ON "ptt_scan_faults" ("reconciliation_bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "ptt_truck_fault_ledger_fleet_key_idx" ON "ptt_truck_fault_ledger" ("fleet_id","canonical_key");--> statement-breakpoint
CREATE INDEX "ptt_truck_fault_ledger_status_idx" ON "ptt_truck_fault_ledger" ("ledger_status");--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD CONSTRAINT "ptt_diagnostic_sessions_Pn174viz3FRk_fkey" FOREIGN KEY ("parent_scan_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ptt_scan_faults" ADD CONSTRAINT "ptt_scan_faults_scan_id_ptt_diagnostic_sessions_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ptt_truck_fault_ledger" ADD CONSTRAINT "ptt_truck_fault_ledger_htbyDoakR3fD_fkey" FOREIGN KEY ("first_seen_scan_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ptt_truck_fault_ledger" ADD CONSTRAINT "ptt_truck_fault_ledger_Bkvu30zWdvBv_fkey" FOREIGN KEY ("last_seen_scan_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ptt_truck_fault_ledger" ADD CONSTRAINT "ptt_truck_fault_ledger_zclHKWw4hHEP_fkey" FOREIGN KEY ("cleared_scan_id") REFERENCES "ptt_diagnostic_sessions"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Data backfill: scans already closed through the legacy AI verification keep that outcome as their case status.
UPDATE "ptt_diagnostic_sessions" SET "case_status" = 'VERIFIED_CLOSED' WHERE "status" = 'VERIFIED_CLOSED';
