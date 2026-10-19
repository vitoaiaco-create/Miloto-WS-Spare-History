ALTER TABLE "mechanical_spares" ADD COLUMN "fitment_axle" integer;--> statement-breakpoint
ALTER TABLE "mechanical_spares" ADD COLUMN "fitment_side" text;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "fitment_axle" integer;--> statement-breakpoint
ALTER TABLE "unmapped_spares_staging" ADD COLUMN "fitment_side" text;