-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('google_places', 'google_business_profile', 'facebook', 'yelp', 'tripadvisor', 'instagram', 'app_store');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'CSV', 'EMAIL');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INACTIVE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "googleAccountId" TEXT,
    "googleRefreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "googleAccountName" TEXT,
    "googleLocationName" TEXT,
    "googlePlaceId" TEXT,
    "displayName" TEXT NOT NULL,
    "formattedAddress" TEXT,
    "primaryCategory" TEXT,
    "rating" DECIMAL(2,1),
    "reviewCount" INTEGER,
    "source" "ReviewSource" NOT NULL DEFAULT 'google_business_profile',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "source" "ReviewSource" NOT NULL DEFAULT 'google_business_profile',
    "sourceReviewId" TEXT,
    "sourceBusinessId" TEXT,
    "googleReviewName" TEXT,
    "googleReviewId" TEXT,
    "reviewerName" TEXT,
    "reviewerPhotoUrl" TEXT,
    "starRating" INTEGER,
    "comment" TEXT,
    "createTime" TIMESTAMP(3),
    "updateTime" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "businessProfileId" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "reviewsFetched" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "source" "ReviewSource",
    "analysisType" TEXT NOT NULL DEFAULT 'review_intelligence',
    "status" "AnalysisStatus" NOT NULL DEFAULT 'COMPLETED',
    "inputReviewCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DECIMAL(2,1),
    "pulseScore" INTEGER,
    "sentimentBreakdown" JSONB,
    "topComplaints" JSONB,
    "topCompliments" JSONB,
    "summary" TEXT,
    "recommendation" TEXT,
    "trendSummary" TEXT,
    "rawPayload" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "analysisResultId" TEXT,
    "cadence" "ReportCadence" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "previewBody" TEXT,
    "exportFormat" "ReportFormat",
    "fileUrl" TEXT,
    "recipientEmail" TEXT,
    "rawPayload" JSONB,
    "generatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_googleLocationName_key" ON "BusinessProfile"("googleLocationName");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_googlePlaceId_key" ON "BusinessProfile"("googlePlaceId");

-- CreateIndex
CREATE INDEX "BusinessProfile_displayName_idx" ON "BusinessProfile"("displayName");

-- CreateIndex
CREATE INDEX "BusinessProfile_googlePlaceId_idx" ON "BusinessProfile"("googlePlaceId");

-- CreateIndex
CREATE INDEX "BusinessProfile_googleLocationName_idx" ON "BusinessProfile"("googleLocationName");

-- CreateIndex
CREATE UNIQUE INDEX "Review_googleReviewName_key" ON "Review"("googleReviewName");

-- CreateIndex
CREATE INDEX "Review_businessProfileId_idx" ON "Review"("businessProfileId");

-- CreateIndex
CREATE INDEX "Review_source_idx" ON "Review"("source");

-- CreateIndex
CREATE INDEX "Review_starRating_idx" ON "Review"("starRating");

-- CreateIndex
CREATE INDEX "Review_createTime_idx" ON "Review"("createTime");

-- CreateIndex
CREATE UNIQUE INDEX "Review_source_sourceReviewId_key" ON "Review"("source", "sourceReviewId");

-- CreateIndex
CREATE INDEX "ReviewSyncJob_status_idx" ON "ReviewSyncJob"("status");

-- CreateIndex
CREATE INDEX "ReviewSyncJob_businessProfileId_idx" ON "ReviewSyncJob"("businessProfileId");

-- CreateIndex
CREATE INDEX "AnalysisResult_businessProfileId_idx" ON "AnalysisResult"("businessProfileId");

-- CreateIndex
CREATE INDEX "AnalysisResult_status_idx" ON "AnalysisResult"("status");

-- CreateIndex
CREATE INDEX "AnalysisResult_generatedAt_idx" ON "AnalysisResult"("generatedAt");

-- CreateIndex
CREATE INDEX "Report_businessProfileId_idx" ON "Report"("businessProfileId");

-- CreateIndex
CREATE INDEX "Report_analysisResultId_idx" ON "Report"("analysisResultId");

-- CreateIndex
CREATE INDEX "Report_cadence_idx" ON "Report"("cadence");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSyncJob" ADD CONSTRAINT "ReviewSyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSyncJob" ADD CONSTRAINT "ReviewSyncJob_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_analysisResultId_fkey" FOREIGN KEY ("analysisResultId") REFERENCES "AnalysisResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

