CREATE TABLE "LeadershipLearningTimeEntry" (
  "id" TEXT NOT NULL,
  "learningRecordId" TEXT NOT NULL,
  "loggedDate" DATE NOT NULL,
  "hours" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadershipLearningTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadershipLearningTimeEntry_learningRecordId_loggedDate_idx"
  ON "LeadershipLearningTimeEntry"("learningRecordId", "loggedDate");

ALTER TABLE "LeadershipLearningTimeEntry"
  ADD CONSTRAINT "LeadershipLearningTimeEntry_learningRecordId_fkey"
  FOREIGN KEY ("learningRecordId") REFERENCES "LeadershipLearningRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
