CREATE TABLE "statement_consumable_exclusions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "statement_consumable_exclusions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"part_number" varchar(100) NOT NULL,
	"material_name" varchar(255) NOT NULL,
	"normalized_part_number" varchar(100) NOT NULL,
	"normalized_material_name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "statement_consumable_exclusions_part_number_idx" ON "statement_consumable_exclusions" ("normalized_part_number");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_consumable_exclusions_material_name_idx" ON "statement_consumable_exclusions" ("normalized_material_name");