-- CreateTable
CREATE TABLE "CaseComment" (
    "id" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseComment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CaseComment" ADD CONSTRAINT "CaseComment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseComment" ADD CONSTRAINT "CaseComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CaseComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
