import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: node scripts/comp-premium-user.js user@example.com");
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const subscription = await prisma.subscription.upsert({
    where: {
      stripeSubscriptionId: `manual:${user.id}`,
    },
    update: {
      plan: "PREMIUM",
      status: "ACTIVE",
      provider: "MANUAL",
      stripeCustomerId: null,
      stripePriceId: null,
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    },
    create: {
      userId: user.id,
      plan: "PREMIUM",
      status: "ACTIVE",
      provider: "MANUAL",
      stripeSubscriptionId: `manual:${user.id}`,
      stripeCustomerId: null,
      stripePriceId: null,
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    },
  });

  console.log(`Comped Premium is ACTIVE for ${email}.`);
  console.log(`Subscription id: ${subscription.id}`);
} catch (error) {
  console.error("Unable to comp Premium access.");
  console.error(error.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
