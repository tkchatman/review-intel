-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'UNPAID';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "stripePriceId" TEXT;
