import { getBearerToken, verifySessionToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { getUserPremiumAccess } from "../services/subscription.service.js";

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function requireAuth(req, res, next) {
  try {
    const payload = verifySessionToken(getBearerToken(req));

    if (!payload) {
      throw httpError("Not authenticated.", 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user) {
      throw httpError("Not authenticated.", 401);
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requirePremium(req, res, next) {
  try {
    const premium = await getUserPremiumAccess(req.user.id);

    if (!premium.hasPremiumAccess) {
      throw httpError("Premium subscription required.", 402);
    }

    req.subscription = premium.subscription;
    next();
  } catch (error) {
    next(error);
  }
}
