-- Add QA note field to RunCase for blocked/skipped/fail reasons
ALTER TABLE "RunCase" ADD COLUMN "note" TEXT;
