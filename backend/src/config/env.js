import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFile), "../..");

dotenv.config({ path: path.join(backendRoot, ".env") });

const stripePremiumPriceId =
  process.env.STRIPE_PRICE_PREMIUM_MONTHLY || process.env.STRIPE_PREMIUM_PRICE_ID || "";
const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || "http://localhost:5173";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    FRONTEND_URL: z.string().url().default(frontendUrl),
    NEXT_PUBLIC_APP_URL: z.string().url().default(frontendUrl),
    DATABASE_URL: z.string().default("postgresql://review_intel_user:review_intel_password@localhost:5432/review_intel_care?schema=public"),
    AUTH_SESSION_SECRET: z.string().min(32).default("review-intel-local-session-secret-change-me"),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:4000/api/auth/google/callback"),
    GOOGLE_PLACES_API_KEY: z.string().default(""),
    GOOGLE_OAUTH_SCOPES: z.string().default("https://www.googleapis.com/auth/business.manage"),
    STRIPE_SECRET_KEY: z.string().default(""),
    STRIPE_WEBHOOK_SECRET: z.string().default(""),
    STRIPE_PRICE_PREMIUM_MONTHLY: z.string().default(stripePremiumPriceId),
    STRIPE_PREMIUM_PRICE_ID: z.string().default(stripePremiumPriceId),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().default(""),
    STRIPE_BILLING_PORTAL_RETURN_URL: z.string().url().default(frontendUrl),
    API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") {
      return;
    }

    for (const key of [
      "DATABASE_URL",
      "AUTH_SESSION_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_PLACES_API_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_PREMIUM_MONTHLY",
    ]) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production.`,
        });
      }
    }
  });

export const env = envSchema.parse(process.env);
env.FRONTEND_URL = env.NEXT_PUBLIC_APP_URL || env.FRONTEND_URL;
env.STRIPE_PRICE_PREMIUM_MONTHLY = env.STRIPE_PRICE_PREMIUM_MONTHLY || env.STRIPE_PREMIUM_PRICE_ID;
env.STRIPE_PREMIUM_PRICE_ID = env.STRIPE_PRICE_PREMIUM_MONTHLY;

export const googleScopes = env.GOOGLE_OAUTH_SCOPES.split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
