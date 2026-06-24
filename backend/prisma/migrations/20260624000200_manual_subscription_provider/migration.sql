-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('STRIPE', 'MANUAL');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "provider" "SubscriptionProvider" NOT NULL DEFAULT 'STRIPE';

-- CreateIndex
CREATE INDEX "Subscription_provider_idx" ON "Subscription"("provider");
