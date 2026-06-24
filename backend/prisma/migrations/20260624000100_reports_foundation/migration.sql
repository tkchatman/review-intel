-- AlterTable
ALTER TABLE "Report" ADD COLUMN "userId" TEXT;
ALTER TABLE "Report" ADD COLUMN "dateRangeStart" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN "dateRangeEnd" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN "emailStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE "Report" ADD COLUMN "emailScheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Report_userId_idx" ON "Report"("userId");
CREATE INDEX "Report_dateRangeStart_idx" ON "Report"("dateRangeStart");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
