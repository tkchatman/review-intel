import { prisma } from "../lib/prisma.js";

const activePremiumStatuses = new Set(["ACTIVE"]);

export function mapStripeSubscriptionStatus(status) {
  const statuses = {
    active: "ACTIVE",
    canceled: "CANCELED",
    incomplete: "INCOMPLETE",
    incomplete_expired: "INACTIVE",
    past_due: "PAST_DUE",
    trialing: "TRIALING",
    unpaid: "UNPAID",
  };

  return statuses[status] ?? "INACTIVE";
}

export function hasPremiumAccess(subscription) {
  return subscription?.plan === "PREMIUM" && activePremiumStatuses.has(subscription.status);
}

export async function getLatestSubscriptionForUser(userId) {
  return prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getUserPremiumAccess(userId) {
  const subscription = await getLatestSubscriptionForUser(userId);

  return {
    hasPremiumAccess: hasPremiumAccess(subscription),
    subscription,
  };
}

function stripeTimestampToDate(timestamp) {
  return timestamp ? new Date(timestamp * 1000) : null;
}

export async function upsertSubscriptionFromStripe(subscription, options = {}) {
  const existingBySubscriptionId = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const userId =
    options.userId ??
    subscription.metadata?.userId ??
    existingBySubscriptionId?.userId;
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  const status = mapStripeSubscriptionStatus(subscription.status);

  if (!userId || !customerId) {
    return null;
  }

  const data = {
    userId,
    plan: "PREMIUM",
    status,
    provider: "STRIPE",
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodStart: stripeTimestampToDate(subscription.current_period_start),
    currentPeriodEnd: stripeTimestampToDate(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    trialEndsAt: stripeTimestampToDate(subscription.trial_end),
  };

  if (existingBySubscriptionId) {
    return prisma.subscription.update({
      where: { id: existingBySubscriptionId.id },
      data,
    });
  }

  const pendingSubscription = await prisma.subscription.findFirst({
    where: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: null,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (pendingSubscription) {
    return prisma.subscription.update({
      where: { id: pendingSubscription.id },
      data,
    });
  }

  return prisma.subscription.create({ data });
}
