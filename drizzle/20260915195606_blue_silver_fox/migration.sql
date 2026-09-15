ALTER TABLE "oil_samples" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "oil_samples" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "oil_samples" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
UPDATE "oil_samples" SET "status" = 'sent' WHERE "status" = 'processed';--> statement-breakpoint
DROP TYPE "sample_status";--> statement-breakpoint
CREATE TYPE "sample_status" AS ENUM('requested', 'drawn', 'sent', 'received');--> statement-breakpoint
ALTER TABLE "oil_samples" ALTER COLUMN "status" SET DATA TYPE "sample_status" USING "status"::"sample_status";--> statement-breakpoint
ALTER TABLE "oil_samples" ALTER COLUMN "status" SET DEFAULT 'requested'::"sample_status";--> statement-breakpoint
ALTER TABLE "oil_samples" ALTER COLUMN "drawn_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oil_samples" ALTER COLUMN "odometer" DROP NOT NULL;