CREATE TABLE "assets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_name" varchar(255) NOT NULL UNIQUE,
	"asset_type" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mechanical_spares" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mechanical_spares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" integer NOT NULL,
	"fitment_date" date NOT NULL,
	"part_number" varchar(100) NOT NULL,
	"material_name" varchar(255) NOT NULL,
	"job_card_no" varchar(50) NOT NULL,
	"quantity" numeric(10,2) NOT NULL,
	"cost_kwacha" numeric(12,2) NOT NULL,
	"tier_1" varchar(100) NOT NULL,
	"tier_2" varchar(100) NOT NULL,
	"tier_3" varchar(100) NOT NULL,
	"installation_point" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "mileage_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mileage_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" integer NOT NULL,
	"date" date NOT NULL,
	"odometer" numeric(12,2) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mechanical_spares_job_card_part_date_idx" ON "mechanical_spares" ("job_card_no","part_number","fitment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "mileage_logs_asset_id_date_idx" ON "mileage_logs" ("asset_id","date");--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD CONSTRAINT "mechanical_spares_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mileage_logs" ADD CONSTRAINT "mileage_logs_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;