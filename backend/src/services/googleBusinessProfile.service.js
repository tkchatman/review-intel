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
    "categories.primaryCategory",
  ].join(",");

  const url = `${businessInformationBaseUrl}/${accountName}/locations?readMask=${encodeURIComponent(fieldMask)}`;
  const data = await googleFetch(url, accessToken);
  return data.locations ?? [];
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
  const accounts = await listAccounts(accessToken);

  for (const account of accounts) {
    const locations = await listAccountLocations(accessToken, account.name);
    const match = locations.find((location) => location.metadata?.placeId === placeId);

    if (match) {
      return { account, location: match };
    }
  }

  return null;
}
