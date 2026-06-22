# Review Intel Care Backend

Production-oriented backend scaffold for connecting the React app to real Google business data.

Important: Google Places can find public businesses and return public rating/review count. Full review retrieval for a Google Business Profile requires OAuth access to a Google account that manages that Business Profile location. Do not put Google API keys or OAuth secrets in the React frontend.

## Folder Structure

```text
backend/
  package.json
  .env.example
  prisma/
    schema.prisma
  src/
    app.js
    server.js
    config/
      env.js
    lib/
      googleOAuth.js
      prisma.js
    middleware/
      asyncHandler.js
      errorHandler.js
    repositories/
      business.repository.js
    routes/
      auth.routes.js
      businesses.routes.js
      reviews.routes.js
    services/
      googleBusinessProfile.service.js
      googlePlaces.service.js
```

## Required Environment Variables

```bash
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://review_intel_user:review_intel_password@localhost:5432/review_intel_care?schema=public

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
GOOGLE_PLACES_API_KEY=...
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/business.manage

API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300
```

## API Flow

1. Frontend sends the user to `GET /api/auth/google`.
2. Google OAuth returns to `GET /api/auth/google/callback`.
3. Backend stores the refresh token server-side.
4. User searches a business with `GET /api/businesses/search?q=Palm Beach Pizza`.
5. Backend searches Google Places Text Search and returns candidate places.
6. User chooses the correct place and frontend calls `POST /api/businesses/connect`.
7. Backend verifies that the selected Place ID belongs to a location managed by the authenticated Google Business Profile account.
8. Frontend calls `POST /api/reviews/sync`.
9. Backend pulls reviews from Google Business Profile API, stores them in PostgreSQL, and returns sync status.
10. Frontend reads stored results with `GET /api/reviews/business/:businessProfileId`.

## API Routes

### `GET /health`

Health check.

### `GET /api/auth/google`

Starts Google OAuth with the `business.manage` scope.

### `GET /api/auth/google/callback`

Stores the Google refresh token server-side and redirects back to the frontend.

### `GET /api/businesses/search?q=<business name>`

Searches Google Places Text Search. Returns real Google place candidates with:

- `placeId`
- `displayName`
- `formattedAddress`
- `rating`
- `reviewCount`
- `businessStatus`
- `googleMapsUri`

### `POST /api/businesses/connect`

Connects a selected Place candidate to a managed Google Business Profile location.

```json
{
  "userId": "user_id_from_oauth_callback",
  "placeId": "google_place_id",
  "displayName": "Palm Beach Pizza",
  "formattedAddress": "West Palm Beach, FL",
  "rating": 4.4,
  "reviewCount": 427
}
```

### `POST /api/reviews/sync`

Pulls real Google Business Profile reviews and stores them.

```json
{
  "userId": "user_id",
  "businessProfileId": "business_profile_id"
}
```

### `GET /api/reviews/business/:businessProfileId`

Returns the stored business profile and latest stored reviews.

## Database Schema

The Prisma schema includes:

- `User`: stores backend user identity and Google refresh token.
- `BusinessProfile`: stores matched Google place/profile metadata, rating, review count, Google account/location IDs.
- `Review`: stores real Google reviews, ratings, reviewer info, timestamps, and raw Google payload.
- `ReviewSyncJob`: tracks review sync status, failures, and counts.

## Production Notes

- Encrypt `googleRefreshToken` before storing it in production.
- Add real session/auth middleware before exposing user-scoped routes.
- Store Google OAuth `state` server-side or in a signed cookie before production launch.
- Use a queue such as BullMQ for large review sync jobs.
- Add request logging, structured logs, and observability.
- Respect Google API quotas and retry only safe transient failures.
- Keep Places API key and OAuth credentials on the server only.
