CREATE TABLE "tire_penalties" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tire_penalties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"date" timestamp NOT NULL,
	"reason" varchar(255) NOT NULL,
	"visual_id" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tire_penalties_visual_id_idx" ON "tire_penalties" ("visual_id");--> statement-breakpoint
ALTER TABLE "tire_penalties" ADD CONSTRAINT "tire_penalties_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;