DROP INDEX "Defect_runResultId_key";

CREATE INDEX "Defect_runResultId_idx" ON "Defect"("runResultId");
