-- CreateIndex
CREATE INDEX "RunResult_runId_idx" ON "RunResult"("runId");

-- CreateIndex
CREATE INDEX "RunResult_testCaseId_idx" ON "RunResult"("testCaseId");

-- CreateIndex
CREATE INDEX "RunResult_runId_status_idx" ON "RunResult"("runId", "status");
