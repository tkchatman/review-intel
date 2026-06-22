import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { getGoogleAuthUrl, exchangeCodeForTokens } from "../lib/googleOAuth.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const authRouter = Router();

authRouter.get("/google", (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  res.redirect(getGoogleAuthUrl(state));
});

authRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    const query = z.object({ code: z.string().min(1) }).parse(req.query);
    const tokens = await exchangeCodeForTokens(query.code);

    const user = await prisma.user.upsert({
      where: { googleAccountId: "google-business-profile-user" },
      update: {
        ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
      },
      create: {
        googleAccountId: "google-business-profile-user",
        googleRefreshToken: tokens.refresh_token,
      },
    });

    res.redirect(`${env.FRONTEND_URL}?googleConnected=true&userId=${user.id}`);
  }),
);
