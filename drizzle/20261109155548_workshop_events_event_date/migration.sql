ALTER TABLE "workshop_events" ADD COLUMN "event_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill: existing events happened when they were logged / migrated.
UPDATE "workshop_events" SET "event_date" = "created_at";
