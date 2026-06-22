import { Router } from "express";
import { z } from "zod";
import { refreshAccessToken } from "../lib/googleOAuth.js";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  upsertBusinessProfile,
  upsertReviews,
} from "../repositories/business.repository.js";
import {
  findManagedLocationByPlaceId,
  listLocationReviews,
} from "../services/googleBusinessProfile.service.js";
import { getFallbackPlaces, searchGooglePlaces } from "../services/googlePlaces.service.js";
import {
  analyzeReviews,
  fetchGooglePlaceReviewDetails,
  normalizeBusinessProfileReview,
  normalizeStoredReview,
} from "../services/reviewInsights.service.js";

export const businessesRouter = Router();

businessesRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        q: z.string().min(2).optional(),
        businessName: z.string().min(2).optional(),
        location: z.string().optional(),
        userId: z.string().optional(),
      })
      .refine((value) => value.q || value.businessName, {
        message: "Provide either q or businessName.",
      })
      .parse(req.query);

    const searchText = query.q ?? `${query.businessName} ${query.location ?? ""}`.trim();

    try {
      const places = await searchGooglePlaces({ query: searchText, maxResults: 50 });

      return res.json({
        source: places.source,
        fallbackReason: places.reason,
        results: places.results.slice(0, 50),
      });
    } catch (error) {
      return res.json({
        source: "fallback",
        fallbackReason: "Google Places returned an error.",
        results: getFallbackPlaces().slice(0, 50),
      });
    }
  }),
);

businessesRouter.get(
  "/:placeId/review-insights",
  asyncHandler(async (req, res) => {
    const params = z.object({ placeId: z.string().min(1) }).parse(req.params);

    try {
      const details = await fetchGooglePlaceReviewDetails(params.placeId);
      const insights = analyzeReviews(details);

      return res.json({ source: "google_places", insights });
    } catch (error) {
      const insights = analyzeReviews({
        source: "google_places",
        limitedReviewText: true,
        place: null,
        reviews: [],
      });

      return res.json({
        source: "google_places",
        fallbackReason: "Google Places details are unavailable right now.",
        insights,
      });
    }
  }),
);

businessesRouter.post(
  "/:placeId/full-review-insights",
  asyncHandler(async (req, res) => {
    const params = z.object({ placeId: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        userId: z.string().min(1),
        name: z.string().min(1),
        address: z.string().optional(),
        rating: z.number().optional().nullable(),
        reviewCount: z.number().int().optional().nullable(),
        category: z.string().optional().nullable(),
      })
      .parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.userId } });
    const token = await refreshAccessToken(user.googleRefreshToken);
    const managedLocation = await findManagedLocationByPlaceId(token.access_token, params.placeId);

    if (!managedLocation) {
      return res.status(403).json({
        error: {
          message:
            "Connect the Google Business Profile account that owns this verified location to analyze all Google reviews.",
        },
      });
    }

    const businessProfile = await upsertBusinessProfile({
      userId: user.id,
      place: {
        placeId: params.placeId,
        displayName: body.name,
        formattedAddress: body.address,
        rating: body.rating,
        reviewCount: body.reviewCount,
      },
      managedLocation,
    });

    const accountId = managedLocation.account.name.split("/").at(-1);
    const locationId = managedLocation.location.name.split("/").at(-1);
    const allReviews = [];
    let pageToken;

    do {
      const response = await listLocationReviews(token.access_token, accountId, locationId, pageToken);
      allReviews.push(...(response.reviews ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    if (allReviews.length) {
      await upsertReviews(businessProfile.id, allReviews, "google_business_profile");
    }

    await prisma.businessProfile.update({
      where: { id: businessProfile.id },
      data: {
        lastSyncedAt: new Date(),
        rating: body.rating,
        reviewCount: allReviews.length || body.reviewCount,
      },
    });

    const storedReviews = await prisma.review.findMany({
      where: { businessProfileId: businessProfile.id },
      orderBy: { updateTime: "desc" },
    });
    const normalizedReviews = storedReviews.length
      ? storedReviews.map(normalizeStoredReview)
      : allReviews.map(normalizeBusinessProfileReview);
    const insights = analyzeReviews({
      source: "google_business_profile",
      limitedReviewText: false,
      place: {
        placeId: params.placeId,
        name: body.name,
        address: body.address,
        rating: body.rating ?? null,
        reviewCount: allReviews.length || body.reviewCount || 0,
        category:
          managedLocation.location.categories?.primaryCategory?.displayName ??
          body.category ??
          null,
        primaryType: body.category ?? null,
        types: [body.category].filter(Boolean),
      },
      reviews: normalizedReviews,
    });

    res.json({
      source: "google_business_profile",
      businessProfileId: businessProfile.id,
      reviewsFetched: allReviews.length,
      insights,
    });
  }),
);

businessesRouter.post(
  "/connect",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        userId: z.string().min(1),
        placeId: z.string().min(1),
        displayName: z.string().min(1),
        formattedAddress: z.string().optional(),
        rating: z.number().optional(),
        reviewCount: z.number().int().optional(),
      })
      .parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.userId } });
    const token = await refreshAccessToken(user.googleRefreshToken);
    const managedLocation = await findManagedLocationByPlaceId(token.access_token, body.placeId);

    if (!managedLocation) {
      return res.status(403).json({
        error: {
          message:
            "This Google place was found publicly, but it is not available in the authenticated Google Business Profile account.",
        },
      });
    }

    const businessProfile = await upsertBusinessProfile({
      userId: user.id,
      place: body,
      managedLocation,
    });

    res.status(201).json({ businessProfile });
  }),
);
