import { prisma } from "../lib/prisma.js";
import { normalizeStoredReview } from "./reviewInsights.service.js";

const limitedDataMessage =
  "Not enough review text available yet. Pull more reviews or upgrade to analyze all available reviews.";

const genericComplimentThemes = [
  { label: "Service Quality", keywords: ["great service", "excellent service", "quality", "great", "excellent", "amazing"] },
  { label: "Staff Friendliness", keywords: ["friendly", "kind", "welcoming", "helpful", "nice", "staff"] },
  { label: "Wait Times", keywords: ["fast", "quick", "prompt", "on time", "no wait"] },
  { label: "Pricing", keywords: ["price", "pricing", "value", "affordable", "reasonable", "worth"] },
  { label: "Cleanliness", keywords: ["clean", "spotless", "tidy", "sanitary"] },
  { label: "Appointment Experience", keywords: ["appointment", "booking", "schedule", "scheduling", "available"] },
  { label: "Customer Service", keywords: ["customer service", "service", "attentive", "helpful", "welcoming"] },
  { label: "Professionalism", keywords: ["professional", "respectful", "knowledgeable", "thorough"] },
  { label: "Communication", keywords: ["communicated", "explained", "responsive", "clear", "updates"] },
  { label: "Atmosphere", keywords: ["atmosphere", "vibe", "environment", "comfortable", "relaxing"] },
  { label: "Product or Service Quality", keywords: ["quality", "result", "results", "work", "product"] },
  { label: "Overall Experience", keywords: ["experience", "recommend", "return", "come back", "satisfied"] },
];

const genericComplaintThemes = [
  { label: "Service Quality", keywords: ["bad service", "poor service", "quality", "issue", "problem"] },
  { label: "Staff Friendliness", keywords: ["rude", "unfriendly", "attitude", "dismissive", "staff"] },
  { label: "Wait Times", keywords: ["wait", "waiting", "slow", "delay", "late", "line"] },
  { label: "Pricing", keywords: ["price", "pricing", "expensive", "overpriced", "cost", "charge"] },
  { label: "Cleanliness", keywords: ["dirty", "unclean", "messy", "sanitary", "clean"] },
  { label: "Appointment Experience", keywords: ["appointment", "booking", "schedule", "reschedule", "cancelled", "canceled"] },
  { label: "Customer Service", keywords: ["customer service", "ignored", "unhelpful", "rude", "service"] },
  { label: "Professionalism", keywords: ["unprofessional", "rushed", "careless"] },
  { label: "Communication", keywords: ["communication", "called", "ignored", "response", "update", "explained"] },
  { label: "Atmosphere", keywords: ["atmosphere", "vibe", "environment", "noise", "uncomfortable"] },
  { label: "Product or Service Quality", keywords: ["quality", "result", "results", "work", "product", "poor"] },
  { label: "Overall Experience", keywords: ["experience", "disappointed", "bad", "terrible", "not recommend"] },
];

const positiveWords = [
  "amazing",
  "best",
  "clean",
  "excellent",
  "friendly",
  "good",
  "great",
  "happy",
  "helpful",
  "love",
  "perfect",
  "professional",
  "recommend",
  "satisfied",
  "thank",
];

const negativeWords = [
  "bad",
  "cancelled",
  "canceled",
  "dirty",
  "disappointed",
  "expensive",
  "ignored",
  "late",
  "overpriced",
  "poor",
  "problem",
  "rude",
  "slow",
  "terrible",
  "unprofessional",
  "wait",
  "worst",
];

function percent(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

function includesKeyword(text, keyword) {
  return text.toLowerCase().includes(keyword);
}

function textSentimentScore(text) {
  const normalized = text.toLowerCase();
  const positives = positiveWords.filter((word) => normalized.includes(word)).length;
  const negatives = negativeWords.filter((word) => normalized.includes(word)).length;
  return positives - negatives;
}

function classifySentiment(review) {
  if (typeof review.rating === "number") {
    if (review.rating >= 4) return "positive";
    if (review.rating === 3) return "neutral";
    return "negative";
  }

  const score = textSentimentScore(review.text);
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

function countThemes(reviews, themes) {
  return themes
    .map((theme) => {
      const count = reviews.filter((review) =>
        theme.keywords.some((keyword) => includesKeyword(review.text, keyword)),
      ).length;

      return {
        label: theme.label,
        count,
        value: `${count} ${count === 1 ? "mention" : "mentions"}`,
      };
    })
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function buildTrendSummary(reviews) {
  const datedReviews = reviews.filter((review) => review.publishTime);

  if (datedReviews.length < 8) {
    return {
      hasTrends: false,
      trendSummary: "Not enough dated reviews available for reliable trend analysis yet.",
      trends: null,
    };
  }

  const monthCounts = datedReviews.reduce((counts, review) => {
    const date = new Date(review.publishTime);
    if (Number.isNaN(date.getTime())) return counts;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const entries = Object.entries(monthCounts).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length < 2) {
    return {
      hasTrends: false,
      trendSummary: "Not enough date range available for reliable trend analysis yet.",
      trends: { monthlyReviewCounts: monthCounts },
    };
  }

  const [previousMonth, previousCount] = entries.at(-2);
  const [latestMonth, latestCount] = entries.at(-1);
  const direction = latestCount > previousCount ? "increased" : latestCount < previousCount ? "decreased" : "stayed flat";

  return {
    hasTrends: true,
    trendSummary: `Review volume ${direction} from ${previousMonth} to ${latestMonth}.`,
    trends: { monthlyReviewCounts: monthCounts },
  };
}

function buildSummary({ businessProfile, reviewCount, topCompliments, topComplaints, positivePercentage, negativePercentage }) {
  const categoryText = businessProfile.primaryCategory
    ? ` in the ${businessProfile.primaryCategory} category`
    : "";
  const complimentText = topCompliments.length
    ? `Customers most often praise ${topCompliments.map((theme) => theme.label.toLowerCase()).join(", ")}.`
    : "The saved review text does not show a repeated compliment theme yet.";
  const complaintText = topComplaints.length
    ? `Common concerns mention ${topComplaints.map((theme) => theme.label.toLowerCase()).join(", ")}.`
    : "The saved review text does not show a repeated complaint theme yet.";

  return `${businessProfile.displayName}${categoryText} has ${reviewCount} saved review texts analyzed. ${positivePercentage}% of analyzed reviews are positive and ${negativePercentage}% are negative. ${complimentText} ${complaintText}`;
}

function buildRecommendations(topComplaints, topCompliments) {
  if (topComplaints.length) {
    return [
      `Prioritize ${topComplaints[0].label.toLowerCase()} because it appears most often in negative review text.`,
      "Review recent low-rated comments weekly so repeated issues are handled before they become trends.",
    ];
  }

  if (topCompliments.length) {
    return [
      `Protect the strong ${topCompliments[0].label.toLowerCase()} experience customers already mention.`,
      "Ask satisfied customers to leave fresh reviews so positive patterns stay visible.",
    ];
  }

  return ["Collect more review text before making operational recommendations."];
}

export async function analyzeSavedReviewsForBusiness(businessProfileId) {
  const businessProfile = await prisma.businessProfile.findUniqueOrThrow({
    where: { id: businessProfileId },
    include: {
      reviews: {
        orderBy: [{ updateTime: "desc" }, { createTime: "desc" }],
      },
    },
  });
  const reviews = businessProfile.reviews.map(normalizeStoredReview);
  const insights = analyzeNormalizedReviewTexts({ businessProfile, reviews });

  const analysisResult = await prisma.analysisResult.create({
    data: {
      businessProfileId,
      source: null,
      status: "COMPLETED",
      inputReviewCount: insights.reviewsAnalyzed,
      rating: businessProfile.rating,
      pulseScore: insights.pulseScore,
      sentimentBreakdown: insights.sentimentBreakdown,
      topComplaints: insights.topComplaints,
      topCompliments: insights.topCompliments,
      summary: insights.aiSummary,
      recommendation: insights.recommendations?.join("\n") ?? insights.recommendation,
      trendSummary: insights.trendSummary,
      rawPayload: insights,
    },
  });

  return { analysisResult, insights: { ...insights, analysisResultId: analysisResult.id } };
}

export function analyzeNormalizedReviewTexts({ businessProfile, reviews }) {
  const reviewsWithText = reviews.filter((review) => review.text.trim().length > 0);
  const sourceBreakdown = reviews.reduce((counts, review) => {
    counts[review.source] = (counts[review.source] ?? 0) + 1;
    return counts;
  }, {});

  if (reviewsWithText.length < 5) {
    const limitedPayload = {
      source: "saved_reviews",
      place: {
        placeId: businessProfile.googlePlaceId,
        name: businessProfile.displayName,
        address: businessProfile.formattedAddress,
        rating: businessProfile.rating ? Number(businessProfile.rating) : null,
        reviewCount: businessProfile.reviewCount ?? reviews.length,
        category: businessProfile.primaryCategory,
      },
      businessType: businessProfile.primaryCategory ?? "local business",
      rating: businessProfile.rating ? Number(businessProfile.rating) : null,
      reviewCount: businessProfile.reviewCount ?? reviews.length,
      reviewsAnalyzed: reviewsWithText.length,
      reviewsAvailable: reviews.length,
      sourceBreakdown,
      sentimentScore: null,
      pulseScore: null,
      pulseLabel: "Not enough data",
      positivePercentage: 0,
      neutralPercentage: 0,
      negativePercentage: 0,
      sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
      topComplaints: [],
      topCompliments: [],
      aiSummary: limitedDataMessage,
      recommendation: limitedDataMessage,
      recommendations: [],
      trendSummary: limitedDataMessage,
      trends: null,
      recentReviews: reviewsWithText.slice(0, 5),
      limitedReviewText: true,
      limitedReviewMessage: limitedDataMessage,
      notEnoughReviewDataMessage: limitedDataMessage,
    };
    return limitedPayload;
  }

  const sentimentGroups = reviewsWithText.reduce(
    (groups, review) => {
      groups[classifySentiment(review)].push(review);
      return groups;
    },
    { positive: [], neutral: [], negative: [] },
  );
  const total = reviewsWithText.length;
  const positivePercentage = percent(sentimentGroups.positive.length, total);
  const neutralPercentage = percent(sentimentGroups.neutral.length, total);
  const negativePercentage = percent(sentimentGroups.negative.length, total);
  const sentimentScore = Math.max(0, Math.min(100, positivePercentage + Math.round(neutralPercentage / 2)));
  const topCompliments = countThemes(sentimentGroups.positive, genericComplimentThemes);
  const topComplaints = countThemes(sentimentGroups.negative, genericComplaintThemes);
  const trendResult = buildTrendSummary(reviewsWithText);
  const recommendations = buildRecommendations(topComplaints, topCompliments);
  const aiSummary = buildSummary({
    businessProfile,
    reviewCount: total,
    topCompliments,
    topComplaints,
    positivePercentage,
    negativePercentage,
  });
  const rating = businessProfile.rating ? Number(businessProfile.rating) : null;
  const insights = {
    source: "saved_reviews",
    place: {
      placeId: businessProfile.googlePlaceId,
      name: businessProfile.displayName,
      address: businessProfile.formattedAddress,
      rating,
      reviewCount: businessProfile.reviewCount ?? reviews.length,
      category: businessProfile.primaryCategory,
    },
    businessType: businessProfile.primaryCategory ?? "local business",
    rating,
    reviewCount: businessProfile.reviewCount ?? reviews.length,
    reviewsAnalyzed: total,
    reviewsAvailable: reviews.length,
    sourceBreakdown,
    sentimentScore,
    pulseScore: sentimentScore,
    pulseLabel: sentimentScore >= 80 ? "Good" : sentimentScore >= 60 ? "Medium" : "Poor",
    positivePercentage,
    neutralPercentage,
    negativePercentage,
    sentimentBreakdown: {
      positive: sentimentGroups.positive.length,
      neutral: sentimentGroups.neutral.length,
      negative: sentimentGroups.negative.length,
    },
    topComplaints,
    topCompliments,
    aiSummary,
    recommendation: recommendations[0],
    recommendations,
    trendSummary: trendResult.trendSummary,
    trends: trendResult.trends,
    recentReviews: reviewsWithText.slice(0, 5),
    limitedReviewText: false,
    limitedReviewMessage: "",
    notEnoughReviewDataMessage: limitedDataMessage,
  };

  return insights;
}
