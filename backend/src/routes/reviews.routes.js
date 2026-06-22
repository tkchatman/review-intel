import { Router } from "express";
import { z } from "zod";
import { refreshAccessToken } from "../lib/googleOAuth.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { upsertReviews } from "../repositories/business.repository.js";
import { listLocationReviews } from "../services/googleBusinessProfile.service.js";

export const reviewsRouter = Router();

reviewsRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        userId: z.string().min(1),
        businessProfileId: z.string().min(1),
      })
      .parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.userId } });
    const businessProfile = await prisma.businessProfile.findUniqueOrThrow({
      where: { id: body.businessProfileId },
    });

    if (!businessProfile.googleLocationName || !businessProfile.googleAccountName) {
      return res.status(400).json({
        error: {
          message: "Business profile is not connected to a managed Google Business Profile location.",
        },
      });
    }

    const job = await prisma.reviewSyncJob.create({
      data: {
        userId: user.id,
        businessProfileId: businessProfile.id,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const token = await refreshAccessToken(user.googleRefreshToken);
    const accountId = businessProfile.googleAccountName.split("/").at(-1);
    const locationId = businessProfile.googleLocationName.split("/").at(-1);

    let pageToken;
    let fetched = 0;

    do {
      const response = await listLocationReviews(token.access_token, accountId, locationId, pageToken);
      const reviews = response.reviews ?? [];
      await upsertReviews(businessProfile.id, reviews, "google_business_profile");
      fetched += reviews.length;
      pageToken = response.nextPageToken;
    } while (pageToken);

    await prisma.businessProfile.update({
      where: { id: businessProfile.id },
      data: { lastSyncedAt: new Date() },
    });

    const completedJob = await prisma.reviewSyncJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        reviewsFetched: fetched,
      },
    });

    res.json({ job: completedJob });
  }),
);

reviewsRouter.get(
  "/business/:businessProfileId",
  asyncHandler(async (req, res) => {
    const params = z.object({ businessProfileId: z.string().min(1) }).parse(req.params);

    const businessProfile = await prisma.businessProfile.findUniqueOrThrow({
      where: { id: params.businessProfileId },
      include: {
        reviews: {
          orderBy: { createTime: "desc" },
          take: 100,
        },
      },
    });

    res.json({ businessProfile });
  }),
);
