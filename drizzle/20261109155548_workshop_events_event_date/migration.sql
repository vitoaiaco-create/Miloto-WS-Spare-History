-- Made idempotent: only add + backfill when the column doesn't already exist,
-- so an existing column's data is never overwritten.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'workshop_events'
			AND column_name = 'event_date'
	) THEN
		ALTER TABLE "workshop_events" ADD COLUMN "event_date" timestamp DEFAULT now() NOT NULL;
		-- Backfill: existing events happened when they were logged / migrated.
		UPDATE "workshop_events" SET "event_date" = "created_at";
	END IF;
END $$;
