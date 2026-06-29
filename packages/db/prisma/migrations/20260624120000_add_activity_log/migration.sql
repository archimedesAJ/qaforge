CREATE TABLE "ActivityLog" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "userName"    TEXT NOT NULL,
  "userEmail"   TEXT NOT NULL,
  "projectId"   TEXT,
  "projectName" TEXT,
  "action"      TEXT NOT NULL,
  "entityType"  TEXT NOT NULL,
  "entityId"    TEXT,
  "entityName"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityLog_userId_idx"    ON "ActivityLog"("userId");
CREATE INDEX "ActivityLog_projectId_idx" ON "ActivityLog"("projectId");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
