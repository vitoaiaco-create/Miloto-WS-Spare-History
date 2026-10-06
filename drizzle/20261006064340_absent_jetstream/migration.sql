CREATE TABLE "master_taxonomy_dictionary" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "master_taxonomy_dictionary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"part_number" text NOT NULL,
	"material_name" text,
	"standardized_material_name" text,
	"tier_1" text,
	"tier_2" text,
	"tier_3" text,
	"brand_name" text,
	"asset_class" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "master_taxonomy_dictionary_part_number_idx" ON "master_taxonomy_dictionary" ("part_number");