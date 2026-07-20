CREATE TABLE "LeadershipOneOnOne" (
  "id" TEXT NOT NULL, "leadId" TEXT NOT NULL, "reportId" TEXT NOT NULL,
  "meetingDate" DATE NOT NULL, "wins" JSONB NOT NULL DEFAULT '[]',
  "discussionPoints" JSONB NOT NULL DEFAULT '[]', "challenges" JSONB NOT NULL DEFAULT '[]',
  "learningDevelopment" JSONB NOT NULL DEFAULT '[]', "managerFeedback" JSONB NOT NULL DEFAULT '[]',
  "actions" JSONB NOT NULL DEFAULT '[]', "privateNotes" TEXT, "presentationSummary" TEXT,
  "nextMeetingDate" DATE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LeadershipOneOnOne_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LeadershipReview" (
  "id" TEXT NOT NULL, "presenterId" TEXT NOT NULL, "department" TEXT NOT NULL,
  "unitName" TEXT NOT NULL, "reportingPeriod" DATE NOT NULL, "meetingDate" DATE,
  "status" TEXT NOT NULL DEFAULT 'draft', "unitHighlights" JSONB NOT NULL DEFAULT '[]',
  "nextPeriodFocus" JSONB NOT NULL DEFAULT '[]', "workingFeedback" JSONB NOT NULL DEFAULT '[]',
  "challengesSupport" JSONB NOT NULL DEFAULT '[]', "decisionsActions" JSONB NOT NULL DEFAULT '[]',
  "crossTeamDependencies" JSONB NOT NULL DEFAULT '[]', "followUps" JSONB NOT NULL DEFAULT '[]',
  "nextMeetingDate" DATE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LeadershipReview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LeadershipReviewEntry" (
  "id" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
  "jobTitle" TEXT, "teamUnit" TEXT, "tasksAchieved" JSONB NOT NULL DEFAULT '[]',
  "inProgress" JSONB NOT NULL DEFAULT '[]', "planned" JSONB NOT NULL DEFAULT '[]',
  "oneOnOneSummary" JSONB NOT NULL DEFAULT '[]', "learningDevelopment" JSONB NOT NULL DEFAULT '[]',
  "managerFeedback" JSONB NOT NULL DEFAULT '[]', "ldHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadershipReviewEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadershipOneOnOne_leadId_meetingDate_idx" ON "LeadershipOneOnOne"("leadId", "meetingDate");
CREATE INDEX "LeadershipOneOnOne_reportId_meetingDate_idx" ON "LeadershipOneOnOne"("reportId", "meetingDate");
CREATE INDEX "LeadershipReview_presenterId_reportingPeriod_idx" ON "LeadershipReview"("presenterId", "reportingPeriod");
CREATE INDEX "LeadershipReviewEntry_employeeId_idx" ON "LeadershipReviewEntry"("employeeId");
CREATE UNIQUE INDEX "LeadershipReviewEntry_reviewId_employeeId_key" ON "LeadershipReviewEntry"("reviewId", "employeeId");
ALTER TABLE "LeadershipOneOnOne" ADD CONSTRAINT "LeadershipOneOnOne_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadershipOneOnOne" ADD CONSTRAINT "LeadershipOneOnOne_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadershipReview" ADD CONSTRAINT "LeadershipReview_presenterId_fkey" FOREIGN KEY ("presenterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadershipReviewEntry" ADD CONSTRAINT "LeadershipReviewEntry_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "LeadershipReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadershipReviewEntry" ADD CONSTRAINT "LeadershipReviewEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
