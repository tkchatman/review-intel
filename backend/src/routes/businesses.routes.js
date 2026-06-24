import { Router } from "express";
import { z } from "zod";
import { refreshAccessToken } from "../lib/googleOAuth.js";
import { getBearerToken, verifySessionToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { decryptToken, encryptToken } from "../lib/tokenCrypto.js";
import { requireAuth, requirePremium } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  upsertBusinessProfile,
  upsertNormalizedReviews,
  upsertReviews,
} from "../repositories/business.repository.js";
import {
  findManagedLocationByPlaceId,
  formatManagedLocationForClient,
  getLocationVerificationState,
  listManagedLocations,
  listLocationReviews,
} from "../services/googleBusinessProfile.service.js";
import { getFallbackPlaces, searchGooglePlaces } from "../services/googlePlaces.service.js";
import {
  fetchGooglePlaceReviewDetails,
} from "../services/reviewInsights.service.js";
import {
  analyzeNormalizedReviewTexts,
  analyzeSavedReviewsForBusiness,
} from "../services/savedReviewAnalysis.service.js";

export const businessesRouter = Router();

function getSessionUserId(req) {
  return verifySessionToken(getBearerToken(req))?.sub ?? null;
}

function routeError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getFreshGoogleAccessToken(user) {
  if (!user.googleRefreshToken) {
    throw routeError("Connect Google Business Profile before syncing full Google reviews.", 400);
  }

  const token = await refreshAccessToken(decryptToken(user.googleRefreshToken));
  const expiresAt = token.expires_in
    ? new Date(Date.now() + Number(token.expires_in) * 1000)
    : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      googleAccessToken: encryptToken(token.access_token),
      googleTokenExpiresAt: expiresAt,
      ...(token.refresh_token ? { googleRefreshToken: encryptToken(token.refresh_token) } : {}),
    },
  });

  return token.access_token;
}

async function getManagedLocationForBusiness({ accessToken, placeId, locationName }) {
  if (locationName) {
    const managedLocations = await listManagedLocations(accessToken);
    return managedLocations.find((managedLocation) => managedLocation.location.name === locationName) ?? null;
  }

  return findManagedLocationByPlaceId(accessToken, placeId);
}

async function syncGoogleBusinessProfileReviews({ user, placeId, business, locationName }) {
  const accessToken = await getFreshGoogleAccessToken(user);
  const managedLocation = await getManagedLocationForBusiness({ accessToken, placeId, locationName });

  if (!managedLocation) {
    throw routeError("Google account does not manage this business.", 403);
  }

  const managedPlaceId = managedLocation.location.metadata?.placeId;
  if (managedPlaceId && managedPlaceId !== placeId) {
    throw routeError("Google account does not manage this business.", 403);
  }

  const verificationState = getLocationVerificationState(managedLocation.location);
  if (verificationState === "NOT_VERIFIED") {
    throw routeError("Location is not verified or reviews are unavailable.", 403);
  }

  const businessProfile = await upsertBusinessProfile({
    userId: user.id,
    place: {
      placeId,
      displayName: business.name,
      formattedAddress: business.address,
      rating: business.rating,
      reviewCount: business.reviewCount,
      category: business.category,
    },
    managedLocation,
  });

  const job = await prisma.reviewSyncJob.create({
    data: {
      userId: user.id,
      businessProfileId: businessProfile.id,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  const accountId = managedLocation.account.name.split("/").at(-1);
  const locationId = managedLocation.location.name.split("/").at(-1);
  const allReviews = [];
  let pageToken;

  try {
    do {
      const response = await listLocationReviews(accessToken, accountId, locationId, pageToken);
      allReviews.push(...(response.reviews ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    const savedReviews = allReviews.length
      ? await upsertReviews(businessProfile.id, allReviews, "google_business_profile")
      : [];

    await prisma.businessProfile.update({
      where: { id: businessProfile.id },
      data: {
        lastSyncedAt: new Date(),
        rating: business.rating,
        reviewCount: allReviews.length || business.reviewCount,
      },
    });

    await prisma.reviewSyncJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        reviewsFetched: allReviews.length,
      },
    });

    const savedAnalysis = await analyzeSavedReviewsForBusiness(businessProfile.id);

    return {
      businessProfile,
      analysisResultId: savedAnalysis.analysisResult.id,
      insights: savedAnalysis.insights,
      reviewsFetched: allReviews.length,
      reviewsSaved: savedReviews.length,
      location: formatManagedLocationForClient(managedLocation),
    };
  } catch (error) {
    await prisma.reviewSyncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error.message,
        reviewsFetched: allReviews.length,
      },
    });
    throw error;
  }
}

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

businessesRouter.post(
  "/profiles/:businessProfileId/analyze-reviews",
  asyncHandler(async (req, res) => {
    const params = z.object({ businessProfileId: z.string().min(1) }).parse(req.params);
    const savedAnalysis = await analyzeSavedReviewsForBusiness(params.businessProfileId);

    res.status(201).json({
      source: "saved_reviews",
      businessProfileId: params.businessProfileId,
      analysisResultId: savedAnalysis.analysisResult.id,
      insights: savedAnalysis.insights,
    });
  }),
);

businessesRouter.get(
  "/google-business-profile/locations",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const accessToken = await getFreshGoogleAccessToken(req.user);
    const managedLocations = await listManagedLocations(accessToken);

    res.json({
      connected: true,
      locations: managedLocations.map(formatManagedLocationForClient),
    });
  }),
);

businessesRouter.post(
  "/:placeId/google-business-profile/sync",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const params = z.object({ placeId: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        locationName: z.string().min(1).optional(),
        name: z.string().min(1),
        address: z.string().optional().nullable(),
        rating: z.number().optional().nullable(),
        reviewCount: z.number().int().optional().nullable(),
        category: z.string().optional().nullable(),
      })
      .parse(req.body);

    const synced = await syncGoogleBusinessProfileReviews({
      user: req.user,
      placeId: params.placeId,
      locationName: body.locationName,
      business: body,
    });

    res.json({
      source: "google_business_profile",
      connectionStatus: "reviews_synced",
      businessProfileId: synced.businessProfile.id,
      analysisResultId: synced.analysisResultId,
      reviewsFetched: synced.reviewsFetched,
      reviewsSaved: synced.reviewsSaved,
      location: synced.location,
      insights: synced.insights,
    });
  }),
);

businessesRouter.get(
  "/:placeId/review-insights",
  asyncHandler(async (req, res) => {
    const params = z.object({ placeId: z.string().min(1) }).parse(req.params);

    try {
      const details = await fetchGooglePlaceReviewDetails(params.placeId);
      let businessProfile = null;
      let reviewsSaved = 0;
      let databaseSaveStatus = "skipped";
      let databaseSaveError;
      let savedAnalysis;

      try {
        if (details.place) {
          businessProfile = await upsertBusinessProfile({
            place: details.place,
            managedLocation: null,
          });
        }

        if (businessProfile && details.reviews.length) {
          const savedReviews = await upsertNormalizedReviews(
            businessProfile.id,
            details.reviews,
            "google_places",
          );
          reviewsSaved = savedReviews.length;
        }

        if (businessProfile) {
          savedAnalysis = await analyzeSavedReviewsForBusiness(businessProfile.id);
        }

        databaseSaveStatus = businessProfile ? "saved" : "skipped";
      } catch (error) {
        databaseSaveStatus = "failed";
        databaseSaveError = error.message;
      }

      const insights =
        savedAnalysis?.insights ??
        analyzeNormalizedReviewTexts({
          businessProfile: {
            displayName: details.place?.name ?? "This business",
            formattedAddress: details.place?.address ?? null,
            googlePlaceId: details.place?.placeId ?? params.placeId,
            primaryCategory: details.place?.category ?? null,
            rating: details.place?.rating ?? null,
            reviewCount: details.place?.reviewCount ?? details.reviews.length,
          },
          reviews: details.reviews,
        });

      return res.json({
        source: "google_places",
        businessProfileId: businessProfile?.id,
        analysisResultId: savedAnalysis?.analysisResult?.id,
        reviewsPulled: details.reviews.length,
        reviewsSaved,
        databaseSaveStatus,
        databaseSaveError,
        limitedData: true,
        limitedDataMessage:
          "Google Places returned a limited public review sample. Saved the available reviews for analysis.",
        insights,
      });
    } catch (error) {
      const insights = analyzeNormalizedReviewTexts({
        businessProfile: {
          displayName: "This business",
          formattedAddress: null,
          googlePlaceId: params.placeId,
          primaryCategory: null,
          rating: null,
          reviewCount: 0,
        },
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
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const params = z.object({ placeId: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        userId: z.string().min(1).optional(),
        locationName: z.string().min(1).optional(),
        name: z.string().min(1),
        address: z.string().optional(),
        rating: z.number().optional().nullable(),
        reviewCount: z.number().int().optional().nullable(),
        category: z.string().optional().nullable(),
      })
      .parse(req.body);

    const synced = await syncGoogleBusinessProfileReviews({
      user: req.user,
      placeId: params.placeId,
      locationName: body.locationName,
      business: body,
    });

    res.json({
      source: "google_business_profile",
      connectionStatus: "reviews_synced",
      businessProfileId: synced.businessProfile.id,
      analysisResultId: synced.analysisResultId,
      reviewsFetched: synced.reviewsFetched,
      reviewsSaved: synced.reviewsSaved,
      location: synced.location,
      insights: synced.insights,
    });
  }),
);

businessesRouter.post(
  "/select",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        placeId: z.string().min(1),
        name: z.string().min(1),
        address: z.string().optional().nullable(),
        rating: z.number().optional().nullable(),
        reviewCount: z.number().int().optional().nullable(),
        category: z.string().optional().nullable(),
      })
      .parse(req.body);

    const businessProfile = await upsertBusinessProfile({
      userId: getSessionUserId(req),
      place: {
        placeId: body.placeId,
        name: body.name,
        address: body.address,
        rating: body.rating,
        reviewCount: body.reviewCount,
        category: body.category,
      },
      managedLocation: null,
    });

    res.status(201).json({ businessProfile });
  }),
);

businessesRouter.post(
  "/connect",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        placeId: z.string().min(1),
        displayName: z.string().min(1),
        formattedAddress: z.string().optional(),
        rating: z.number().optional(),
        reviewCount: z.number().int().optional(),
      })
      .parse(req.body);

    const accessToken = await getFreshGoogleAccessToken(req.user);
    const managedLocation = await findManagedLocationByPlaceId(accessToken, body.placeId);

    if (!managedLocation) {
      return res.status(403).json({
        error: {
          message:
            "This Google place was found publicly, but it is not available in the authenticated Google Business Profile account.",
        },
      });
    }

    const businessProfile = await upsertBusinessProfile({
      userId: req.user.id,
      place: body,
      managedLocation,
    });

    res.status(201).json({ businessProfile });
  }),
);
