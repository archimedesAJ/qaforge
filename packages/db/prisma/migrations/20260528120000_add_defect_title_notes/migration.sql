-- AlterTable: add title, notes, updatedAt to Defect
ALTER TABLE "Defect" ADD COLUMN "title" TEXT;
ALTER TABLE "Defect" ADD COLUMN "notes" TEXT;
ALTER TABLE "Defect" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
