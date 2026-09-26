CREATE TABLE "monthly_asset_distances" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monthly_asset_distances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" integer NOT NULL,
	"month_year" date NOT NULL,
	"manual_distance" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_asset_distances_month_year_first_day" CHECK (extract(day from "month_year") = 1),
	CONSTRAINT "monthly_asset_distances_manual_distance_nonneg" CHECK ("manual_distance" is null or "manual_distance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_asset_distances_asset_id_month_year_idx" ON "monthly_asset_distances" ("asset_id","month_year");--> statement-breakpoint
ALTER TABLE "monthly_asset_distances" ADD CONSTRAINT "monthly_asset_distances_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;