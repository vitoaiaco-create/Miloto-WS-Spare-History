ALTER TABLE "mechanical_spares" RENAME COLUMN "cost_kwacha" TO "price_kwacha";--> statement-breakpoint
ALTER TABLE "mechanical_spares" RENAME COLUMN "cost_usd" TO "amount_usd";--> statement-breakpoint
ALTER TABLE "mechanical_spares" RENAME COLUMN "fitment_date" TO "outward_date";--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" RENAME COLUMN "cost_kwacha" TO "price_kwacha";--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" RENAME COLUMN "cost_usd" TO "amount_usd";--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" RENAME COLUMN "fitment_date" TO "outward_date";--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "s_no" integer;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "sub_category" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "job_card_type" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "sub_equipment" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "supplier_name" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "docket_no" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "vehicle_no" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "identity_no" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "odometer" integer;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "ex_rate" numeric(12,4);--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "amount_kwacha" numeric(12,2);--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "issued_by" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "collected_by" text;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "return_quantity" numeric(10,2);--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "s_no" integer;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "sub_category" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "job_card_type" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "sub_equipment" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "supplier_name" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "docket_no" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "vehicle_no" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "identity_no" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "odometer" integer;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "ex_rate" numeric(12,4);--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "amount_kwacha" numeric(12,2);--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "issued_by" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "collected_by" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "return_quantity" numeric(10,2);