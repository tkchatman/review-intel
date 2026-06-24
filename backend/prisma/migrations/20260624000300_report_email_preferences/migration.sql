-- CreateTable
CREATE TABLE "ReportEmailPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "frequency" "ReportCadence" NOT NULL,
    "destinationEmail" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportEmailPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportEmailPreference_userId_businessProfileId_key" ON "ReportEmailPreference"("userId", "businessProfileId");
CREATE INDEX "ReportEmailPreference_userId_idx" ON "ReportEmailPreference"("userId");
CREATE INDEX "ReportEmailPreference_businessProfileId_idx" ON "ReportEmailPreference"("businessProfileId");
CREATE INDEX "ReportEmailPreference_frequency_idx" ON "ReportEmailPreference"("frequency");
CREATE INDEX "ReportEmailPreference_enabled_idx" ON "ReportEmailPreference"("enabled");

-- AddForeignKey
ALTER TABLE "ReportEmailPreference" ADD CONSTRAINT "ReportEmailPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportEmailPreference" ADD CONSTRAINT "ReportEmailPreference_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
