-- Make runResultId nullable (standalone defects have no linked result)
ALTER TABLE "Defect" ALTER COLUMN "runResultId" DROP NOT NULL;

-- Add projectId for direct project ownership
ALTER TABLE "Defect" ADD COLUMN "projectId" TEXT;

-- Backfill projectId from existing linked defects
UPDATE "Defect" d
SET "projectId" = (
  SELECT r."projectId"
  FROM "RunResult" rr
  JOIN "TestRun" r ON rr."runId" = r.id
  WHERE rr.id = d."runResultId"
)
WHERE d."runResultId" IS NOT NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "Defect" ALTER COLUMN "projectId" SET NOT NULL;

-- FK to Project with cascade delete
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for project-scoped queries
CREATE INDEX "Defect_projectId_idx" ON "Defect"("projectId");
