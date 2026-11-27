ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "closure_mode" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "closure_reason_category" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "closure_note" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "closed_by" text;--> statement-breakpoint
ALTER TABLE "ptt_diagnostic_sessions" ADD COLUMN "closed_at" timestamp;