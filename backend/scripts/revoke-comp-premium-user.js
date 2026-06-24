import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: node scripts/revoke-comp-premium-user.js user@example.com");
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      userId: user.id,
      provider: "MANUAL",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!subscription) {
    console.log(`No manual comped Premium subscription found for ${email}.`);
    process.exit(0);
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CANCELED",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(),
    },
  });

  console.log(`Manual comped Premium was revoked for ${email}.`);
} catch (error) {
  console.error("Unable to revoke manual Premium access.");
  console.error(error.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
