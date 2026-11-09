CREATE TABLE "workshop_events" (
	"id" serial PRIMARY KEY,
	"asset_id" integer NOT NULL,
	"event_category" varchar(50) NOT NULL,
	"event_outcome" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workshop_events" ADD CONSTRAINT "workshop_events_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;