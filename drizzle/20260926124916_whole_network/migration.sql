CREATE TABLE "part_description_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "part_description_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_name" varchar(255) NOT NULL,
	"normalized_name" varchar(255) NOT NULL UNIQUE,
	"alias" varchar(255) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar(255)
);
