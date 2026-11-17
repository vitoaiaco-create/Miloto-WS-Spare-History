-- Made idempotent in case the table was already created out-of-band.
CREATE TABLE IF NOT EXISTS "monthly_asset_pairings" (
	"id" serial PRIMARY KEY,
	"active_month" date NOT NULL,
	"truck_id" integer,
	"trailer_id" integer,
	"driver_name" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "monthly_asset_pairings" ADD CONSTRAINT "monthly_asset_pairings_truck_id_assets_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "assets"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "monthly_asset_pairings" ADD CONSTRAINT "monthly_asset_pairings_trailer_id_assets_id_fkey" FOREIGN KEY ("trailer_id") REFERENCES "assets"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
