CREATE TABLE "LeadershipLearningRecord" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT,
  "skillArea" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "startDate" DATE,
  "targetCompletionDate" DATE,
  "completionDate" DATE,
  "expiryDate" DATE,
  "learningHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidenceUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadershipLearningRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadershipLearningRecord_createdById_status_idx" ON "LeadershipLearningRecord"("createdById", "status");
CREATE INDEX "LeadershipLearningRecord_employeeId_status_idx" ON "LeadershipLearningRecord"("employeeId", "status");
CREATE INDEX "LeadershipLearningRecord_expiryDate_idx" ON "LeadershipLearningRecord"("expiryDate");
ALTER TABLE "LeadershipLearningRecord" ADD CONSTRAINT "LeadershipLearningRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadershipLearningRecord" ADD CONSTRAINT "LeadershipLearningRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
