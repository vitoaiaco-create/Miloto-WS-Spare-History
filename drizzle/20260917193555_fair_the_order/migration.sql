CREATE TABLE "monthly_fleet_km" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monthly_fleet_km_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"month_year" date NOT NULL,
	"total_km" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_fleet_km_month_year_first_day" CHECK (extract(day from "month_year") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_fleet_km_month_year_idx" ON "monthly_fleet_km" ("month_year");