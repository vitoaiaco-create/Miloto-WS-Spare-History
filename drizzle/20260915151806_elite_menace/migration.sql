CREATE TYPE "sample_status" AS ENUM('drawn', 'processed', 'sent', 'received');--> statement-breakpoint
CREATE TABLE "oil_consumption_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"asset_id" integer NOT NULL,
	"record_date" timestamp NOT NULL,
	"quantity" real NOT NULL,
	"job_card_no" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oil_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"asset_id" integer NOT NULL,
	"drawn_date" timestamp NOT NULL,
	"status" "sample_status" DEFAULT 'drawn'::"sample_status" NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "oil_consumption_logs" ADD CONSTRAINT "oil_consumption_logs_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oil_samples" ADD CONSTRAINT "oil_samples_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;