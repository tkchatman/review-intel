const accountManagementBaseUrl = "https://mybusinessaccountmanagement.googleapis.com/v1";
const businessInformationBaseUrl = "https://mybusinessbusinessinformation.googleapis.com/v1";
const reviewsBaseUrl = "https://mybusiness.googleapis.com/v4";

async function googleFetch(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Business Profile request failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function listAccounts(accessToken) {
  const data = await googleFetch(`${accountManagementBaseUrl}/accounts`, accessToken);
  return data.accounts ?? [];
}

export async function listAccountLocations(accessToken, accountName) {
  const fieldMask = [
    "name",
    "title",
    "storefrontAddress",
    "metadata.placeId",
    "metadata.mapsUri",
    "metadata.hasVoiceOfMerchant",
    "categories.primaryCategory",
  ].join(",");

  const url = `${businessInformationBaseUrl}/${accountName}/locations?readMask=${encodeURIComponent(fieldMask)}`;
  const data = await googleFetch(url, accessToken);
  return data.locations ?? [];
}

export async function listManagedLocations(accessToken) {
  const accounts = await listAccounts(accessToken);
  const managedLocations = [];

  for (const account of accounts) {
    const locations = await listAccountLocations(accessToken, account.name);

    for (const location of locations) {
      managedLocations.push({ account, location });
    }
  }

  return managedLocations;
}

export async function listLocationReviews(accessToken, accountId, locationId, pageToken) {
  const params = new URLSearchParams({
    pageSize: "50",
    orderBy: "updateTime desc",
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const url = `${reviewsBaseUrl}/accounts/${accountId}/locations/${locationId}/reviews?${params.toString()}`;
  return googleFetch(url, accessToken);
}

export async function findManagedLocationByPlaceId(accessToken, placeId) {
  const managedLocations = await listManagedLocations(accessToken);
  const match = managedLocations.find(({ location }) => location.metadata?.placeId === placeId);

  return match ?? null;
}

export function getLocationVerificationState(location) {
  if (location?.metadata?.hasVoiceOfMerchant === true) {
    return "VERIFIED";
  }

  if (location?.metadata?.hasVoiceOfMerchant === false) {
    return "NOT_VERIFIED";
  }

  return "UNKNOWN";
}

export function formatManagedLocationForClient({ account, location }) {
  const address = location.storefrontAddress;
  const addressLines = [
    ...(address?.addressLines ?? []),
    [address?.locality, address?.administrativeArea, address?.postalCode].filter(Boolean).join(", "),
  ].filter(Boolean);
  const verificationState = getLocationVerificationState(location);

  return {
    accountName: account.name,
    locationName: location.name,
    title: location.title,
    address: addressLines.join(" "),
    placeId: location.metadata?.placeId ?? null,
    category: location.categories?.primaryCategory?.displayName ?? null,
    mapsUri: location.metadata?.mapsUri ?? null,
    verificationState,
    isVerified: verificationState === "VERIFIED",
  };
}
