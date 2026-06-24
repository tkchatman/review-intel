import { prisma } from "../lib/prisma.js";

export async function upsertBusinessProfile({ userId, place, managedLocation }) {
  const location = managedLocation?.location;
  const displayName = place.displayName ?? place.name;
  const formattedAddress = place.formattedAddress ?? place.address;
  const primaryCategory = location?.categories?.primaryCategory?.displayName ?? place.category;
  const source = managedLocation ? "google_business_profile" : "google_places";
  const updateData = {
    displayName,
    formattedAddress,
    rating: place.rating,
    reviewCount: place.reviewCount,
    primaryCategory,
  };

  if (userId) {
    updateData.userId = userId;
  }

  if (managedLocation) {
    updateData.googleAccountName = managedLocation.account?.name;
    updateData.googleLocationName = location?.name;
    updateData.source = source;
    updateData.lastSyncedAt = new Date();
  }

  return prisma.businessProfile.upsert({
    where: { googlePlaceId: place.placeId },
    update: updateData,
    create: {
      userId,
      googleAccountName: managedLocation?.account?.name,
      googleLocationName: location?.name,
      googlePlaceId: place.placeId,
      displayName,
      formattedAddress,
      rating: place.rating,
      reviewCount: place.reviewCount,
      primaryCategory,
      source,
      lastSyncedAt: new Date(),
    },
  });
}

export async function upsertReviews(
  businessProfileId,
  reviews,
  source = "google_business_profile",
) {
  const operations = reviews
    .map((review) => {
      const reviewer = review.reviewer ?? {};
      const starRating = Number(String(review.starRating ?? "").replace("STAR_RATING_", "")) || null;
      const sourceReviewId = review.name ?? review.reviewId;

      if (!sourceReviewId) {
        return null;
      }

      return prisma.review.upsert({
        where: {
          source_sourceReviewId: {
            source,
            sourceReviewId,
          },
        },
        update: {
          source,
          sourceReviewId,
          sourceBusinessId: review.locationName,
          reviewerName: reviewer.displayName,
          reviewerPhotoUrl: reviewer.profilePhotoUrl,
          starRating,
          comment: review.comment,
          createTime: review.createTime ? new Date(review.createTime) : null,
          updateTime: review.updateTime ? new Date(review.updateTime) : null,
          rawPayload: review,
        },
        create: {
          businessProfileId,
          source,
          sourceReviewId,
          sourceBusinessId: review.locationName,
          googleReviewName: review.name,
          googleReviewId: review.reviewId,
          reviewerName: reviewer.displayName,
          reviewerPhotoUrl: reviewer.profilePhotoUrl,
          starRating,
          comment: review.comment,
          createTime: review.createTime ? new Date(review.createTime) : null,
          updateTime: review.updateTime ? new Date(review.updateTime) : null,
          rawPayload: review,
        },
      });
    })
    .filter(Boolean);

  return operations.length ? prisma.$transaction(operations) : [];
}

export async function upsertNormalizedReviews(businessProfileId, reviews, source) {
  const operations = reviews
    .filter((review) => review.sourceReviewId)
    .map((review) =>
      prisma.review.upsert({
        where: {
          source_sourceReviewId: {
            source,
            sourceReviewId: review.sourceReviewId,
          },
        },
        update: {
          source,
          sourceReviewId: review.sourceReviewId,
          sourceBusinessId: review.sourceBusinessId,
          reviewerName: review.authorName,
          reviewerPhotoUrl: review.authorPhotoUrl,
          starRating: review.rating,
          comment: review.text,
          createTime: review.publishTime ? new Date(review.publishTime) : null,
          updateTime: review.updateTime ? new Date(review.updateTime) : null,
          rawPayload: review.rawPayload ?? review,
        },
        create: {
          businessProfileId,
          source,
          sourceReviewId: review.sourceReviewId,
          sourceBusinessId: review.sourceBusinessId,
          reviewerName: review.authorName,
          reviewerPhotoUrl: review.authorPhotoUrl,
          starRating: review.rating,
          comment: review.text,
          createTime: review.publishTime ? new Date(review.publishTime) : null,
          updateTime: review.updateTime ? new Date(review.updateTime) : null,
          rawPayload: review.rawPayload ?? review,
        },
      }),
    );

  return operations.length ? prisma.$transaction(operations) : [];
}
