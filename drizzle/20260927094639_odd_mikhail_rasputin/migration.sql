CREATE TABLE "manual_alignment_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_alignment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" integer NOT NULL,
	"date" date NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "manual_alignment_events" ADD CONSTRAINT "manual_alignment_events_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;