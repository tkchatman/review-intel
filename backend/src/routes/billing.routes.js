import { Router } from "express";
import { env } from "../config/env.js";
import { assertStripeConfigured, getStripeConfigStatus, stripe } from "../lib/stripe.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  getUserPremiumAccess,
  upsertSubscriptionFromStripe,
} from "../services/subscription.service.js";

export const billingRouter = Router();
export const stripeWebhookRouter = Router();

function billingError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

billingRouter.get("/subscription", requireAuth, async (req, res, next) => {
  try {
    const premium = await getUserPremiumAccess(req.user.id);

    res.json({
      hasPremiumAccess: premium.hasPremiumAccess,
      subscription: premium.subscription,
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/checkout-session", requireAuth, async (req, res, next) => {
  try {
    assertStripeConfigured();

    const existing = await getUserPremiumAccess(req.user.id);

    if (existing.hasPremiumAccess) {
      return res.json({ alreadySubscribed: true });
    }

    let customerId = existing.subscription?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email ?? undefined,
        name: req.user.name ?? undefined,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;

      await prisma.subscription.create({
        data: {
          userId: req.user.id,
          plan: "PREMIUM",
          status: "INACTIVE",
          stripeCustomerId: customerId,
          stripePriceId: env.STRIPE_PRICE_PREMIUM_MONTHLY,
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: env.STRIPE_PRICE_PREMIUM_MONTHLY,
          quantity: 1,
        },
      ],
      success_url: `${env.FRONTEND_URL}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}?checkout=canceled`,
      subscription_data: {
        metadata: {
          userId: req.user.id,
        },
      },
      metadata: {
        userId: req.user.id,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout session failed:", {
      message: error.message,
      code: error.code,
      type: error.type,
      missing: error.missing,
    });
    next(error);
  }
});

billingRouter.post("/checkout-session/confirm", requireAuth, async (req, res, next) => {
  try {
    assertStripeConfigured();

    const sessionId = req.body?.sessionId;

    if (!sessionId) {
      throw billingError("Checkout session id is required.", 400);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.metadata?.userId !== req.user.id) {
      throw billingError("Checkout session does not belong to this account.", 403);
    }

    const premium = await getUserPremiumAccess(req.user.id);

    res.json({
      hasPremiumAccess: premium.hasPremiumAccess,
      subscription: premium.subscription,
      pendingWebhook: !premium.hasPremiumAccess && session.payment_status === "paid",
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.post("/portal-session", requireAuth, async (req, res, next) => {
  try {
    assertStripeConfigured();
    const premium = await getUserPremiumAccess(req.user.id);
    const customerId = premium.subscription?.stripeCustomerId;

    if (!customerId) {
      throw billingError("No Stripe customer exists for this account yet.", 400);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: env.STRIPE_BILLING_PORTAL_RETURN_URL,
    });

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

stripeWebhookRouter.post("/", async (req, res) => {
  const config = getStripeConfigStatus({ includeWebhook: true });

  if (!stripe || !config.configured) {
    const message = `Stripe webhook is not configured. Missing required environment variable${config.missing.length === 1 ? "" : "s"}: ${config.missing.join(", ")}.`;
    console.error(message);
    return res.status(503).json({ error: { message, missing: config.missing } });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get("stripe-signature"),
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    return res.status(400).json({ error: { message: `Webhook signature verification failed: ${error.message}` } });
  }

  try {
    if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    ) {
      await upsertSubscriptionFromStripe(event.data.object);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await upsertSubscriptionFromStripe(subscription, { userId: session.metadata?.userId });
      }
    }

    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});
