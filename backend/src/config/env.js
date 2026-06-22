import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFile), "../..");

dotenv.config({ path: path.join(backendRoot, ".env") });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    DATABASE_URL: z.string().default("postgresql://review_intel_user:review_intel_password@localhost:5432/review_intel_care?schema=public"),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:4000/api/auth/google/callback"),
    GOOGLE_PLACES_API_KEY: z.string().default(""),
    GOOGLE_OAUTH_SCOPES: z.string().default("https://www.googleapis.com/auth/business.manage"),
    API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") {
      return;
    }

    for (const key of ["DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_PLACES_API_KEY"]) {
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

export const googleScopes = env.GOOGLE_OAUTH_SCOPES.split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
