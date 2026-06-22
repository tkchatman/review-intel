import { env } from "../config/env.js";

const textSearchUrl = "https://places.googleapis.com/v1/places:searchText";

const fallbackPlaces = [
  {
    placeId: "fallback-google-place-palm-beach-pizza",
    name: "Palm Beach Pizza",
    address: "West Palm Beach, FL",
    displayName: "Palm Beach Pizza",
    formattedAddress: "West Palm Beach, FL",
    rating: 4.4,
    reviewCount: 427,
    category: "Restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: null,
    location: null,
  },
  {
    placeId: "fallback-google-place-palm-beach-pizza-grill",
    name: "Palm Beach Pizza & Grill",
    address: "Royal Palm Beach, FL",
    displayName: "Palm Beach Pizza & Grill",
    formattedAddress: "Royal Palm Beach, FL",
    rating: 4.1,
    reviewCount: 213,
    category: "Restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: null,
    location: null,
  },
  {
    placeId: "fallback-google-place-palm-beach-pizza-express",
    name: "Palm Beach Pizza Express",
    address: "Boynton Beach, FL",
    displayName: "Palm Beach Pizza Express",
    formattedAddress: "Boynton Beach, FL",
    rating: 4.6,
    reviewCount: 189,
    category: "Restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: null,
    location: null,
  },
];

export function shouldUsePlacesFallback() {
  const key = env.GOOGLE_PLACES_API_KEY.trim().toLowerCase();
  return !key || key === "test";
}

export function getFallbackPlaces() {
  return fallbackPlaces.map((place) => ({ ...place }));
}

function mapGooglePlace(place) {
  const name = place.displayName?.text ?? null;
  const address = place.formattedAddress ?? null;

  return {
    placeId: place.id,
    name,
    address,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    category: place.primaryTypeDisplayName?.text ?? place.primaryType ?? place.types?.[0] ?? null,
    businessStatus: place.businessStatus,
    googleMapsUri: place.googleMapsUri,
    location: place.location,
    displayName: name,
    formattedAddress: address,
  };
}

export async function searchGooglePlaces({ query, locationBias, maxResults = 50 }) {
  if (shouldUsePlacesFallback()) {
    return {
      source: "fallback",
      results: getFallbackPlaces().slice(0, maxResults),
      reason: "GOOGLE_PLACES_API_KEY is missing or set to test.",
    };
  }

  const resultsByPlaceId = new Map();
  let pageToken;

  while (resultsByPlaceId.size < maxResults) {
    const body = {
      textQuery: query,
      pageSize: Math.min(20, maxResults - resultsByPlaceId.size),
      ...(pageToken ? { pageToken } : {}),
      ...(locationBias ? { locationBias } : {}),
    };

    const response = await fetch(textSearchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": [
          "nextPageToken",
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.rating",
          "places.userRatingCount",
          "places.primaryType",
          "places.primaryTypeDisplayName",
          "places.types",
          "places.businessStatus",
          "places.googleMapsUri",
          "places.location",
        ].join(","),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Google Places search failed: ${response.status}`);
    }

    const data = await response.json();

    for (const place of data.places ?? []) {
      if (place.id && !resultsByPlaceId.has(place.id)) {
        resultsByPlaceId.set(place.id, mapGooglePlace(place));
      }
    }

    pageToken = data.nextPageToken;

    if (!pageToken) {
      break;
    }
  }

  return {
    source: "google_places",
    results: [...resultsByPlaceId.values()].slice(0, maxResults),
  };
}
