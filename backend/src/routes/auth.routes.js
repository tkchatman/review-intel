import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  createSessionToken,
  getBearerToken,
  hashPassword,
  publicUser,
  verifyPassword,
  verifySessionToken,
} from "../lib/auth.js";
import { getGoogleAuthUrl, exchangeCodeForTokens } from "../lib/googleOAuth.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/tokenCrypto.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requirePremium } from "../middleware/authMiddleware.js";
import { getUserPremiumAccess } from "../services/subscription.service.js";

export const authRouter = Router();

const authBodySchema = z.object({
  email: z.string().email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(8),
});

const signupBodySchema = authBodySchema.extend({
  name: z.string().min(1).max(120).transform((name) => name.trim()),
});

function authError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function authResponse(user) {
  const premium = await getUserPremiumAccess(user.id);

  return {
    user: {
      ...publicUser(user),
      hasPremiumAccess: premium.hasPremiumAccess,
      subscription: premium.subscription,
      googleBusinessProfileConnected: Boolean(user.googleRefreshToken),
    },
    token: createSessionToken(user),
  };
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = signupBodySchema.parse(req.body);
    const existingUser = await prisma.user.findUnique({ where: { email: body.email } });

    if (existingUser) {
      throw authError("An account with this email already exists.", 409);
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
      },
    });

    res.status(201).json(await authResponse(user));
  }),
);

authRouter.post(
  "/signin",
  asyncHandler(async (req, res) => {
    const body = authBodySchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const validPassword = await verifyPassword(body.password, user?.passwordHash);

    if (!user || !validPassword) {
      throw authError("Invalid email or password.", 401);
    }

    res.json(await authResponse(user));
  }),
);

authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const payload = verifySessionToken(getBearerToken(req));

    if (!payload) {
      throw authError("Not authenticated.", 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user) {
      throw authError("Not authenticated.", 401);
    }

    const premium = await getUserPremiumAccess(user.id);

    res.json({
      user: {
        ...publicUser(user),
        hasPremiumAccess: premium.hasPremiumAccess,
        subscription: premium.subscription,
        googleBusinessProfileConnected: Boolean(user.googleRefreshToken),
      },
    });
  }),
);

authRouter.post("/logout", (req, res) => {
  res.json({ ok: true });
});

authRouter.get(
  "/google/url",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
      throw authError(
        "Google Business Profile OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
        500,
      );
    }

    const state = createSessionToken(req.user);
    res.json({ url: getGoogleAuthUrl(state) });
  }),
);

authRouter.get("/google", (req, res) => {
  res.status(401).json({
    error: {
      message: "Sign in to Review Intel Care before connecting Google Business Profile.",
    },
  });
});

authRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    const payload = verifySessionToken(query.state);

    if (!payload?.sub) {
      return res.redirect(`${env.FRONTEND_URL}?googleConnected=error`);
    }

    const tokens = await exchangeCodeForTokens(query.code);
    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
      : null;

    await prisma.user.update({
      where: { id: payload.sub },
      data: {
        googleAccountId: tokens.scope?.includes("business.manage")
          ? "google-business-profile"
          : "google-oauth",
        googleAccessToken: encryptToken(tokens.access_token),
        googleTokenExpiresAt: tokenExpiresAt,
        ...(tokens.refresh_token
          ? { googleRefreshToken: encryptToken(tokens.refresh_token) }
          : {}),
      },
    });

    res.redirect(`${env.FRONTEND_URL}?googleConnected=true`);
  }),
);
