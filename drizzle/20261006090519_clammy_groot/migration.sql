CREATE TABLE "unmapped_spares_staging" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unmapped_spares_staging_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" integer NOT NULL,
	"fitment_date" date NOT NULL,
	"part_number" varchar(100) NOT NULL,
	"material_name" varchar(255) NOT NULL,
	"job_card_no" varchar(50) NOT NULL,
	"quantity" numeric(10,2) NOT NULL,
	"cost_kwacha" numeric(12,2) NOT NULL,
	"price_usd" numeric(12,2),
	"cost_usd" numeric(12,2),
	"installation_point" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unmapped_spares_staging_job_card_part_date_idx" ON "unmapped_spares_staging" ("job_card_no","part_number","fitment_date");--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD CONSTRAINT "unmapped_spares_staging_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;