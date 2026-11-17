-- Made idempotent: the live DB already had these columns (schema was out of sync with migration history).
ALTER TABLE "mechanical_spares" ADD COLUMN IF NOT EXISTS "location" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN IF NOT EXISTS "location" text;
