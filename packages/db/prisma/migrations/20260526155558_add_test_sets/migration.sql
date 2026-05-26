-- CreateTable
CREATE TABLE "TestSet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSetItem" (
    "id" SERIAL NOT NULL,
    "setId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,

    CONSTRAINT "TestSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSet_projectId_idx" ON "TestSet"("projectId");

-- CreateIndex
CREATE INDEX "TestSetItem_setId_idx" ON "TestSetItem"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "TestSetItem_setId_testCaseId_key" ON "TestSetItem"("setId", "testCaseId");

-- AddForeignKey
ALTER TABLE "TestSet" ADD CONSTRAINT "TestSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSet" ADD CONSTRAINT "TestSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSetItem" ADD CONSTRAINT "TestSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "TestSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSetItem" ADD CONSTRAINT "TestSetItem_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
