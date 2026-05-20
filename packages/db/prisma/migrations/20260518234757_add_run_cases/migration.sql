-- CreateTable
CREATE TABLE "RunCase" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_run',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunCase_runId_idx" ON "RunCase"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "RunCase_runId_testCaseId_key" ON "RunCase"("runId", "testCaseId");

-- AddForeignKey
ALTER TABLE "RunCase" ADD CONSTRAINT "RunCase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunCase" ADD CONSTRAINT "RunCase_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
