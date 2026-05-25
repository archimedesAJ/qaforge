-- CreateTable
CREATE TABLE "CaseLink" (
    "id" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLink_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CaseLink" ADD CONSTRAINT "CaseLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
