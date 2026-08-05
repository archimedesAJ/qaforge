-- Dedicated lifecycle timestamps keep reporting stable when a defect is edited
-- after resolution. Existing records use their last update as the best
-- available historical approximation.
ALTER TABLE "Defect"
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "wontFixAt" TIMESTAMP(3);

UPDATE "Defect"
SET "resolvedAt" = "updatedAt"
WHERE "status" IN ('resolved', 'closed');

UPDATE "Defect"
SET "closedAt" = "updatedAt"
WHERE "status" = 'closed';

UPDATE "Defect"
SET "wontFixAt" = "updatedAt"
WHERE "status" = 'wont_fix';

CREATE INDEX "Defect_resolvedAt_idx" ON "Defect"("resolvedAt");
CREATE INDEX "Defect_closedAt_idx" ON "Defect"("closedAt");
CREATE INDEX "Defect_wontFixAt_idx" ON "Defect"("wontFixAt");
