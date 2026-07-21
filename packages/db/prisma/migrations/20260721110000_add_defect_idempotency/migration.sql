ALTER TABLE "Defect" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "Defect_clientRequestId_key" ON "Defect"("clientRequestId");
