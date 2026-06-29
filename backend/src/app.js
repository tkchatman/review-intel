import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { billingRouter, stripeWebhookRouter } from "./routes/billing.routes.js";
import { businessesRouter } from "./routes/businesses.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { reviewsRouter } from "./routes/reviews.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export const app = express();

const allowedOrigins = new Set(
  [
    env.FRONTEND_URL,
    env.NEXT_PUBLIC_APP_URL,
    "https://www.reviewintelcare.com",
    "https://reviewintelcare.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean),
);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use("/api/billing/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter);
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(
  rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    limit: env.API_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/billing", billingRouter);
app.use("/api/businesses", businessesRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/reviews", reviewsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
