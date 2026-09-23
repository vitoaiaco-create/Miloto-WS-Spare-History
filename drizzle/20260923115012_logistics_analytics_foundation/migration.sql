CREATE TABLE "drivers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drivers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL UNIQUE,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_pairings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monthly_pairings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trailer_id" integer NOT NULL,
	"truck_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"active_month" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tire_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"asset_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"incident_date" timestamp NOT NULL,
	"penalty_type" varchar(255) NOT NULL,
	"penalty_points" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_pairings_trailer_id_active_month_idx" ON "monthly_pairings" ("trailer_id","active_month");--> statement-breakpoint
ALTER TABLE "monthly_pairings" ADD CONSTRAINT "monthly_pairings_trailer_id_assets_id_fkey" FOREIGN KEY ("trailer_id") REFERENCES "assets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "monthly_pairings" ADD CONSTRAINT "monthly_pairings_truck_id_assets_id_fkey" FOREIGN KEY ("truck_id") REFERENCES "assets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "monthly_pairings" ADD CONSTRAINT "monthly_pairings_driver_id_drivers_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tire_incidents" ADD CONSTRAINT "tire_incidents_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tire_incidents" ADD CONSTRAINT "tire_incidents_driver_id_drivers_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE;