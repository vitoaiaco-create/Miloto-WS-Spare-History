-- Made idempotent in case the enum values were already added out-of-band.
ALTER TYPE "manual_statement_event_type" ADD VALUE IF NOT EXISTS 'AIR_SYSTEM_OK';--> statement-breakpoint
ALTER TYPE "manual_statement_event_type" ADD VALUE IF NOT EXISTS 'AIR_SYSTEM_FAIL';
