ALTER TABLE "Defect"
ADD COLUMN "detectedEnvironment" TEXT NOT NULL DEFAULT 'unknown';

UPDATE "Defect" AS defect
SET "detectedEnvironment" = CASE
  WHEN LOWER(run.env) LIKE '%prod%' THEN 'production'
  WHEN LOWER(run.env) LIKE '%stag%' OR LOWER(run.env) LIKE '%uat%' THEN 'staging'
  WHEN LOWER(run.env) LIKE '%dev%' OR LOWER(run.env) LIKE '%local%' THEN 'development'
  ELSE 'testing'
END
FROM "RunResult" AS result
JOIN "TestRun" AS run ON run.id = result."runId"
WHERE defect."runResultId" = result.id;

CREATE INDEX "Defect_detectedEnvironment_severity_createdAt_idx"
ON "Defect"("detectedEnvironment", "severity", "createdAt");
