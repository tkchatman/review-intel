import Stripe from "stripe";
import { env } from "../config/env.js";

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

export function getStripeConfigStatus({ includeWebhook = false } = {}) {
  const required = [
    ["STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY],
    ["STRIPE_PRICE_PREMIUM_MONTHLY", env.STRIPE_PRICE_PREMIUM_MONTHLY],
  ];

  if (includeWebhook) {
    required.push(["STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET]);
  }

  const missing = required
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
  };
}

export function assertStripeConfigured() {
  const config = getStripeConfigStatus();

  if (!stripe || !config.configured) {
    const missing = config.missing.length ? config.missing : ["STRIPE_SECRET_KEY"];
    const message = `Stripe billing is not configured. Missing required environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
    console.error(message);
    const error = new Error(message);
    error.statusCode = 503;
    error.code = "STRIPE_CONFIG_MISSING";
    error.missing = missing;
    throw error;
  }
}
