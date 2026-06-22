import { env } from "../config/env.js";
import { shouldUsePlacesFallback } from "./googlePlaces.service.js";

const placeDetailsBaseUrl = "https://places.googleapis.com/v1/places";
const limitedReviewMessage =
  "Limited Google review text available. Connect Google Business Profile for deeper analysis.";
const notEnoughReviewDataMessage = "Not enough review data available yet.";

const industryThemeProfiles = [
  {
    businessType: "barbershop",
    matchers: ["barber", "barbershop", "hair_care", "hair salon", "salon", "beauty_salon"],
    complimentThemes: [
      { label: "Haircut Quality", keywords: ["haircut", "cut", "trim", "style", "styled", "sharp", "clean cut"] },
      { label: "Barber Skill", keywords: ["barber", "skilled", "talented", "master", "professional", "attention to detail"] },
      { label: "Fade Quality", keywords: ["fade", "taper", "line up", "lineup", "edge up", "blend"] },
      { label: "Beard Trim", keywords: ["beard", "shave", "mustache", "razor"] },
      { label: "Customer Service", keywords: ["service", "friendly", "welcoming", "kind", "helpful"] },
      { label: "Appointment Availability", keywords: ["appointment", "booking", "schedule", "walk in", "walk-in"] },
      { label: "Atmosphere", keywords: ["atmosphere", "vibe", "shop", "environment", "comfortable"] },
      { label: "Professionalism", keywords: ["professional", "respectful", "punctual", "on time"] },
      { label: "Pricing", keywords: ["price", "pricing", "worth", "value", "affordable"] },
    ],
    complaintThemes: [
      { label: "Haircut Quality", keywords: ["bad haircut", "uneven", "messed up", "too short", "crooked", "fix my hair"] },
      { label: "Fade Quality", keywords: ["bad fade", "fade", "taper", "line up", "lineup", "edge up", "blend"] },
      { label: "Beard Trim", keywords: ["beard", "shave", "razor", "mustache"] },
      { label: "Appointment Availability", keywords: ["appointment", "booking", "schedule", "reschedule", "cancelled", "canceled"] },
      { label: "Wait Times", keywords: ["wait", "waiting", "slow", "late", "delay", "walk in", "walk-in"] },
      { label: "Pricing", keywords: ["expensive", "overpriced", "price", "pricing", "cost", "charge"] },
      { label: "Customer Service", keywords: ["rude", "service", "attitude", "ignored", "unprofessional"] },
      { label: "Cleanliness", keywords: ["dirty", "unclean", "hair everywhere", "sanitary", "clean"] },
    ],
  },
  {
    businessType: "dentist",
    matchers: ["dentist", "dental", "orthodontist"],
    complimentThemes: [
      { label: "Staff Friendliness", keywords: ["friendly", "kind", "staff", "welcoming", "helpful"] },
      { label: "Pain Management", keywords: ["pain", "painless", "gentle", "comfortable"] },
      { label: "Scheduling", keywords: ["appointment", "schedule", "booking", "available"] },
      { label: "Cleanliness", keywords: ["clean", "spotless", "sanitary"] },
      { label: "Professionalism", keywords: ["professional", "explained", "thorough", "knowledgeable"] },
    ],
    complaintThemes: [
      { label: "Wait Times", keywords: ["wait", "waiting", "late", "delay"] },
      { label: "Pain Management", keywords: ["pain", "painful", "rough", "hurt"] },
      { label: "Scheduling", keywords: ["appointment", "schedule", "cancelled", "canceled", "reschedule"] },
      { label: "Billing", keywords: ["bill", "billing", "insurance", "charge", "expensive"] },
      { label: "Staff Friendliness", keywords: ["rude", "staff", "unfriendly", "attitude"] },
    ],
  },
  {
    businessType: "restaurant",
    matchers: ["restaurant", "food", "cafe", "bar", "pizza", "bakery", "meal_takeaway"],
    complimentThemes: [
      { label: "Food Quality", keywords: ["food", "delicious", "fresh", "tasty", "flavor", "amazing"] },
      { label: "Service", keywords: ["service", "server", "staff", "friendly", "attentive"] },
      { label: "Portion Size", keywords: ["portion", "serving", "large", "generous"] },
      { label: "Pricing", keywords: ["price", "value", "affordable", "worth"] },
      { label: "Cleanliness", keywords: ["clean", "spotless", "fresh"] },
    ],
    complaintThemes: [
      { label: "Food Quality", keywords: ["food", "cold", "burnt", "stale", "undercooked", "overcooked", "bland"] },
      { label: "Service", keywords: ["service", "server", "rude", "ignored", "slow"] },
      { label: "Portion Size", keywords: ["portion", "small", "serving"] },
      { label: "Pricing", keywords: ["price", "expensive", "overpriced", "cost"] },
      { label: "Cleanliness", keywords: ["dirty", "unclean", "bathroom", "restroom"] },
      { label: "Wait Times", keywords: ["wait", "waiting", "slow", "delay"] },
    ],
  },
  {
    businessType: "auto repair shop",
    matchers: ["auto", "car_repair", "mechanic", "oil", "tire"],
    complimentThemes: [
      { label: "Repair Quality", keywords: ["repair", "fixed", "quality", "work", "diagnosed"] },
      { label: "Pricing", keywords: ["price", "fair", "honest", "affordable", "value"] },
      { label: "Turnaround Time", keywords: ["fast", "quick", "same day", "turnaround", "time"] },
      { label: "Communication", keywords: ["communicated", "explained", "update", "clear"] },
      { label: "Trustworthiness", keywords: ["trust", "honest", "reliable", "transparent"] },
    ],
    complaintThemes: [
      { label: "Repair Quality", keywords: ["repair", "fixed", "broke", "problem", "issue", "diagnosis"] },
      { label: "Pricing", keywords: ["price", "expensive", "overcharged", "cost", "charge"] },
      { label: "Turnaround Time", keywords: ["slow", "wait", "delay", "days", "late"] },
      { label: "Communication", keywords: ["communication", "called", "update", "explained", "ignored"] },
      { label: "Trustworthiness", keywords: ["dishonest", "scam", "trust", "lied", "upsell"] },
    ],
  },
];

function normalizeReview(review) {
  const text = review.text?.text ?? review.originalText?.text ?? "";
  const sourceReviewId =
    review.name ??
    [
      "google_places",
      review.authorAttribution?.displayName,
      review.publishTime,
      text.slice(0, 80),
    ]
      .filter(Boolean)
      .join(":");

  return {
    source: "google_places",
    sourceReviewId,
    sourceBusinessId: null,
    rating: typeof review.rating === "number" ? review.rating : null,
    text,
    publishTime: review.publishTime ?? null,
    updateTime: null,
    relativePublishTimeDescription: review.relativePublishTimeDescription ?? null,
    authorName: review.authorAttribution?.displayName ?? null,
    authorPhotoUrl: review.authorAttribution?.photoUri ?? null,
    rawPayload: review,
  };
}

export function normalizeBusinessProfileReview(review) {
  const starRating = Number(String(review.starRating ?? "").replace("STAR_RATING_", "")) || null;

  return {
    source: "google_business_profile",
    sourceReviewId: review.name ?? review.reviewId,
    sourceBusinessId: review.locationName ?? null,
    rating: starRating,
    text: review.comment ?? "",
    publishTime: review.createTime ?? null,
    updateTime: review.updateTime ?? null,
    relativePublishTimeDescription: null,
    authorName: review.reviewer?.displayName ?? null,
    authorPhotoUrl: review.reviewer?.profilePhotoUrl ?? null,
    rawPayload: review,
  };
}

export function normalizeStoredReview(review) {
  return {
    source: review.source,
    sourceReviewId: review.sourceReviewId,
    sourceBusinessId: review.sourceBusinessId,
    rating: review.starRating,
    text: review.comment ?? "",
    publishTime: review.createTime?.toISOString?.() ?? review.createTime ?? null,
    updateTime: review.updateTime?.toISOString?.() ?? review.updateTime ?? null,
    relativePublishTimeDescription: null,
    authorName: review.reviewerName,
    authorPhotoUrl: review.reviewerPhotoUrl,
    rawPayload: review.rawPayload,
  };
}

function containsTheme(text, theme) {
  const normalizedText = text.toLowerCase();
  return theme.keywords.some((keyword) => normalizedText.includes(keyword));
}

function getBusinessCategoryText(place) {
  return [
    place?.category,
    place?.primaryType,
    ...(place?.types ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .replaceAll("_", " ")
    .toLowerCase();
}

function getIndustryProfile(place) {
  const categoryText = getBusinessCategoryText(place);

  return (
    industryThemeProfiles.find((profile) =>
      profile.matchers.some((matcher) => categoryText.includes(matcher.replaceAll("_", " ").toLowerCase())),
    ) ?? {
      businessType: place?.category?.toLowerCase() || "local business",
      complimentThemes: [
        { label: "Service Quality", keywords: ["service", "helpful", "friendly", "professional", "great"] },
        { label: "Pricing", keywords: ["price", "pricing", "value", "affordable", "worth"] },
        { label: "Communication", keywords: ["communicated", "explained", "responsive", "clear"] },
        { label: "Atmosphere", keywords: ["atmosphere", "vibe", "environment", "comfortable"] },
      ],
      complaintThemes: [
        { label: "Service Quality", keywords: ["service", "rude", "unprofessional", "ignored", "bad"] },
        { label: "Wait Times", keywords: ["wait", "waiting", "slow", "delay", "late"] },
        { label: "Pricing", keywords: ["price", "expensive", "overpriced", "cost", "charge"] },
        { label: "Communication", keywords: ["communication", "called", "ignored", "response", "update"] },
      ],
    }
  );
}

function countThemes(reviews, themes) {
  return themes
    .map((theme) => {
      const count = reviews.filter((review) => review.text && containsTheme(review.text, theme)).length;

      return {
        label: theme.label,
        count,
        value: `${count} ${count === 1 ? "mention" : "mentions"}`,
      };
    })
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function calculatePulseScore(rating, reviews) {
  const ratingScore = typeof rating === "number" ? Math.round((rating / 5) * 100) : null;
  const ratedReviews = reviews.filter((review) => typeof review.rating === "number");

  if (!ratedReviews.length) {
    return ratingScore;
  }

  const reviewAverage =
    ratedReviews.reduce((total, review) => total + review.rating, 0) / ratedReviews.length;
  const reviewScore = Math.round((reviewAverage / 5) * 100);

  if (ratingScore === null) {
    return reviewScore;
  }

  return Math.round(ratingScore * 0.7 + reviewScore * 0.3);
}

function getPulseLabel(score) {
  if (score === null || score === undefined) {
    return "Not enough data";
  }

  if (score >= 80) {
    return "Good";
  }

  if (score >= 60) {
    return "Medium";
  }

  return "Poor";
}

function buildSummary({ name, businessType, rating, reviewCount, reviewsWithText, complaints, compliments }) {
  if (reviewsWithText.length < 3) {
    return notEnoughReviewDataMessage;
  }

  const ratingText = typeof rating === "number" ? `${rating.toFixed(1)} stars` : "no public rating";
  const reviewCountText =
    typeof reviewCount === "number" ? `${reviewCount} total reviews` : "an unknown review count";
  const complimentText = compliments.length
    ? `Customers consistently praise ${compliments.map((theme) => theme.label.toLowerCase()).join(", ")}.`
    : "The available review text does not show a repeated compliment theme yet.";
  const complaintText = complaints.length
    ? `The most common complaint themes involve ${complaints.map((theme) => theme.label.toLowerCase()).join(", ")}.`
    : "The available review text does not show a repeated complaint theme yet.";

  return `${name} is a ${businessType} with ${ratingText} from ${reviewCountText}. Based on ${reviewsWithText.length} available review texts, ${complimentText} ${complaintText}`;
}

export async function fetchGooglePlaceReviewDetails(placeId) {
  if (shouldUsePlacesFallback()) {
    return {
      source: "unavailable",
      limitedReviewText: true,
      limitedReviewMessage,
      place: null,
      reviews: [],
    };
  }

  const response = await fetch(`${placeDetailsBaseUrl}/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "id",
        "displayName",
        "formattedAddress",
        "rating",
        "userRatingCount",
        "primaryType",
        "primaryTypeDisplayName",
        "types",
        "reviews",
      ].join(","),
    },
  });

  if (!response.ok) {
    throw new Error(`Google Place Details failed: ${response.status}`);
  }

  const place = await response.json();

  return {
    source: "google_places",
    limitedReviewText: false,
    limitedReviewMessage,
    place: {
      placeId: place.id,
      name: place.displayName?.text ?? null,
      address: place.formattedAddress ?? null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? 0,
      category: place.primaryTypeDisplayName?.text ?? place.primaryType ?? place.types?.[0] ?? null,
      primaryType: place.primaryType ?? null,
      types: place.types ?? [],
    },
    reviews: (place.reviews ?? []).map(normalizeReview),
  };
}

export function analyzeReviews({ place, reviews, source, limitedReviewText }) {
  const reviewsWithText = reviews.filter((review) => review.text.trim().length > 0);
  const industryProfile = getIndustryProfile(place);
  const negativeReviews = reviewsWithText.filter((review) => review.rating !== null && review.rating <= 3);
  const positiveReviews = reviewsWithText.filter((review) => review.rating === null || review.rating >= 4);
  const hasEnoughReviewText = reviewsWithText.length >= 3;
  const topComplaints = hasEnoughReviewText
    ? countThemes(negativeReviews, industryProfile.complaintThemes)
    : [];
  const topCompliments = hasEnoughReviewText
    ? countThemes(positiveReviews, industryProfile.complimentThemes)
    : [];
  const pulseScore = calculatePulseScore(place?.rating ?? null, reviews);
  const positiveCount = reviews.filter((review) => typeof review.rating === "number" && review.rating >= 4).length;
  const neutralCount = reviews.filter((review) => typeof review.rating === "number" && review.rating === 3).length;
  const negativeCount = reviews.filter((review) => typeof review.rating === "number" && review.rating <= 2).length;
  const strongestCompliment = topCompliments[0]?.label.toLowerCase();
  const strongestComplaint = topComplaints[0]?.label.toLowerCase();
  const sourceBreakdown = reviews.reduce((counts, review) => {
    const reviewSource = review.source ?? source ?? "unknown";
    counts[reviewSource] = (counts[reviewSource] ?? 0) + 1;
    return counts;
  }, {});

  return {
    source,
    place,
    businessType: industryProfile.businessType,
    rating: place?.rating ?? null,
    reviewCount: place?.reviewCount ?? 0,
    pulseScore,
    pulseLabel: getPulseLabel(pulseScore),
    reviewsAnalyzed: reviewsWithText.length,
    reviewsAvailable: reviews.length,
    sourceBreakdown,
    supportedSources: [
      "google_places",
      "google_business_profile",
      "facebook",
      "yelp",
      "tripadvisor",
      "instagram",
      "app_store",
    ],
    recentReviews: reviewsWithText.slice(0, 5),
    sentimentBreakdown: {
      positive: positiveCount,
      neutral: neutralCount,
      negative: negativeCount,
    },
    topComplaints,
    topCompliments,
    trendSummary:
      reviewsWithText.length < 3
        ? notEnoughReviewDataMessage
        : `Available reviews for this ${industryProfile.businessType} most often mention ${
            strongestComplaint || strongestCompliment || "general customer experience"
          }. Connect Google Business Profile for time-based trend history.`,
    recommendation:
      reviewsWithText.length < 3
        ? notEnoughReviewDataMessage
        : strongestComplaint
          ? `Prioritize improving ${strongestComplaint} because it appears in the available review text.`
          : strongestCompliment
            ? `Protect the strong ${strongestCompliment} experience customers are already mentioning.`
            : notEnoughReviewDataMessage,
    aiSummary: buildSummary({
      name: place?.name ?? "This business",
      businessType: industryProfile.businessType,
      rating: place?.rating ?? null,
      reviewCount: place?.reviewCount ?? null,
      reviewsWithText,
      complaints: topComplaints,
      compliments: topCompliments,
    }),
    limitedReviewText: limitedReviewText || !hasEnoughReviewText,
    limitedReviewMessage,
    notEnoughReviewDataMessage,
  };
}

export const analyzeGoogleReviews = analyzeReviews;
