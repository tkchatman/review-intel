import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const SELECTED_BUSINESS_STORAGE_KEY = "selectedBusiness";
const SELECTED_PLACE_ID_STORAGE_KEY = "selectedGooglePlaceId";
const GOOGLE_USER_ID_STORAGE_KEY = "googleBusinessUserId";

function loadSelectedBusiness() {
  try {
    const savedBusiness = localStorage.getItem(SELECTED_BUSINESS_STORAGE_KEY);
    return savedBusiness ? JSON.parse(savedBusiness) : null;
  } catch (error) {
    console.warn("Unable to load selected business from localStorage.", error);
    return null;
  }
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

function getPulseScoreFromRating(rating) {
  return typeof rating === "number" ? Math.round((rating / 5) * 100) : null;
}

function getSourceLabel(source) {
  const labels = {
    google_places: "Google Places",
    google_business_profile: "Google Business Profile",
    facebook: "Facebook",
    yelp: "Yelp",
    tripadvisor: "TripAdvisor",
    instagram: "Instagram",
    app_store: "App Store",
  };

  return labels[source] ?? source ?? "Unknown source";
}

function loadGoogleUserIdFromCallback() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userId");

  if (params.get("googleConnected") === "true" && userId) {
    localStorage.setItem(GOOGLE_USER_ID_STORAGE_KEY, userId);
    window.history.replaceState({}, "", window.location.pathname);
    return userId;
  }

  return localStorage.getItem(GOOGLE_USER_ID_STORAGE_KEY);
}

function App() {
  const [initialSelectedBusiness] = useState(() => loadSelectedBusiness());
  const [page, setPage] = useState(initialSelectedBusiness ? "free" : "home");
  const [selectedBusiness, setSelectedBusiness] = useState(initialSelectedBusiness);
  const [selectedGooglePlaceId, setSelectedGooglePlaceId] = useState(() =>
    initialSelectedBusiness?.placeId ?? localStorage.getItem(SELECTED_PLACE_ID_STORAGE_KEY),
  );
  const [selectedPlan, setSelectedPlan] = useState("free");
  const [businessResults, setBusinessResults] = useState([]);
  const [searchSource, setSearchSource] = useState("");
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchError, setSearchError] = useState("");
  const [googleUserId, setGoogleUserId] = useState(() => loadGoogleUserIdFromCallback());
  const [reviewInsights, setReviewInsights] = useState(null);
  const [insightStatus, setInsightStatus] = useState("idle");
  const [insightError, setInsightError] = useState("");

  useEffect(() => {
    if (!selectedBusiness?.placeId) {
      setReviewInsights(null);
      setInsightStatus("idle");
      setInsightError("");
      return;
    }

    const controller = new AbortController();

    async function loadInsights() {
      setInsightStatus("loading");
      setInsightError("");

      try {
        const response = googleUserId
          ? await fetch(
              `${API_BASE_URL}/api/businesses/${encodeURIComponent(selectedBusiness.placeId)}/full-review-insights`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: googleUserId,
                  name: selectedBusiness.name,
                  address: selectedBusiness.address ?? selectedBusiness.location,
                  rating: selectedBusiness.rating,
                  reviewCount: selectedBusiness.reviewCount,
                  category: selectedBusiness.category,
                }),
                signal: controller.signal,
              },
            )
          : await fetch(
              `${API_BASE_URL}/api/businesses/${encodeURIComponent(selectedBusiness.placeId)}/review-insights`,
              { signal: controller.signal },
            );

        if (!response.ok) {
          throw new Error("Unable to load review insights right now.");
        }

        const data = await response.json();
        setReviewInsights({
          ...data.insights,
          analysisSource: data.source ?? data.insights?.source,
          reviewsFetched: data.reviewsFetched,
        });
        setInsightStatus("success");
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setInsightError(error.message);
        setInsightStatus("error");
      }
    }

    loadInsights();

    return () => controller.abort();
  }, [selectedBusiness, googleUserId]);

  const startSignup = (plan) => {
    setSelectedPlan(plan);
    setPage("signup");
  };

  const searchBusinesses = async ({ businessName, location }) => {
    setSearchStatus("loading");
    setSearchError("");
    setBusinessResults([]);

    try {
      const params = new URLSearchParams({
        businessName: businessName.trim(),
        location: location.trim(),
      });
      const response = await fetch(`${API_BASE_URL}/api/businesses/search?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Unable to search Google Places right now.");
      }

      const data = await response.json();
      setBusinessResults(data.results ?? []);
      setSearchSource(data.source ?? "google");
      setPage("results");
      setSearchStatus("success");
    } catch (error) {
      setSearchError(error.message);
      setSearchStatus("error");
    }
  };

  const chooseBusiness = (business) => {
    const selected = {
      placeId: business.placeId,
      name: business.name ?? business.displayName,
      address: business.address ?? business.formattedAddress,
      location: business.address ?? business.formattedAddress,
      rating: business.rating ?? null,
      reviewCount: business.reviewCount ?? 0,
      reviews: business.reviewCount ?? 0,
      category: business.category ?? "Google Business Profile",
      googlePlaceId: business.placeId,
    };

    console.log("Selected business:", selected);
    setSelectedBusiness(selected);
    setSelectedGooglePlaceId(selected.placeId);
    localStorage.setItem(SELECTED_BUSINESS_STORAGE_KEY, JSON.stringify(selected));
    localStorage.setItem(SELECTED_PLACE_ID_STORAGE_KEY, selected.placeId);
    setPage("free");
  };

  const continueToDashboard = () => {
    if (!selectedBusiness) {
      setPage("home");
      return;
    }

    if (selectedPlan === "premium") {
      setPage("premium");
    } else {
      setPage("free");
    }
  };

  const signOut = () => {
    setSelectedBusiness(null);
    setSelectedGooglePlaceId(null);
    setReviewInsights(null);
    setInsightStatus("idle");
    setInsightError("");
    setGoogleUserId(null);
    localStorage.removeItem(SELECTED_BUSINESS_STORAGE_KEY);
    localStorage.removeItem(SELECTED_PLACE_ID_STORAGE_KEY);
    localStorage.removeItem(GOOGLE_USER_ID_STORAGE_KEY);
    setPage("home");
  };

  return (
    <div className="app">
      {page === "home" && (
        <HomePage
          searchBusinesses={searchBusinesses}
          searchStatus={searchStatus}
          searchError={searchError}
          startSignup={startSignup}
        />
      )}

      {page === "results" && (
        <ResultsPage
          results={businessResults}
          source={searchSource}
          chooseBusiness={chooseBusiness}
          setPage={setPage}
        />
      )}

      {page === "free" && (
        <FreeDashboard
          business={selectedBusiness}
          insights={reviewInsights}
          insightStatus={insightStatus}
          insightError={insightError}
          googleUserId={googleUserId}
          startSignup={startSignup}
          signOut={signOut}
        />
      )}

      {page === "premium" && (
        <PremiumDashboard
          business={selectedBusiness}
          insights={reviewInsights}
          insightStatus={insightStatus}
          insightError={insightError}
          googleUserId={googleUserId}
          selectedGooglePlaceId={selectedGooglePlaceId}
          signOut={signOut}
        />
      )}

      {page === "signup" && (
        <SignupPage
          selectedPlan={selectedPlan}
          setSelectedPlan={setSelectedPlan}
          setPage={setPage}
        />
      )}

      {page === "checkout" && (
        <CheckoutPage selectedPlan={selectedPlan} setPage={setPage} />
      )}

      {page === "success" && (
        <SuccessPage
          selectedPlan={selectedPlan}
          continueToDashboard={continueToDashboard}
        />
      )}
    </div>
  );
}

function HomePage({ searchBusinesses, searchStatus, searchError, startSignup }) {
  const [businessName, setBusinessName] = useState("");
  const [location, setLocation] = useState("");

  const handleSearch = (event) => {
    event.preventDefault();
    searchBusinesses({ businessName, location });
  };

  return (
    <main className="home">
      <nav className="nav">
        <div className="logo">REVIEW INTEL CARE</div>

        <div className="navActions">
          <button className="navGhost" onClick={() => startSignup("free")}>
            Sign In
          </button>
          <button className="navGold" onClick={() => startSignup("free")}>
            Create Account
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">AI-powered review intelligence</p>
          <h1>Know what customers love, hate, and want fixed.</h1>
          <p className="subtitle">
            Review Intel Care reads customer reviews and turns them into a clear
            business dashboard with complaints, compliments, trends, AI answers,
            and executive reports.
          </p>

          <form className="heroSearch" onSubmit={handleSearch}>
            <input
              placeholder="Business name"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              required
            />
            <input
              placeholder="City or location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
            <button disabled={searchStatus === "loading"}>
              {searchStatus === "loading" ? "Searching..." : "Find My Business"}
            </button>
          </form>

          {searchError && <p className="searchError">{searchError}</p>}
        </div>
      </section>

      <section className="previewSection">
        <div className="sectionIntro centered">
          <p className="eyebrow">Free vs Premium</p>
          <h2>See what customers are saying. Upgrade to understand why.</h2>
          <p>
            Start with a simple review snapshot, then unlock deeper insights
            that show what is changing, what needs attention, and what actions
            matter most.
          </p>
        </div>

        <div className="stackedPlans">
          <div className="planPanel freePanel">
            <div className="planHeader">
              <div>
                <p className="planLabel">Free Plan</p>
                <h3>Review Snapshot</h3>
                <p className="planDescription">
                  Includes your customer score, reviews analyzed, top complaints,
                  top compliments, and a quick AI summary.
                </p>
              </div>

              <span className="pricePill">
                <strong>Free</strong>
                <small>$0/month</small>
              </span>
            </div>

            <div className="statStrip">
              <div className="scoreCard">
                <p>Customer Pulse Score</p>
                <strong>
                  <span className="statusDot">🟢 Good</span>
                  87/100
                </strong>

                <div className="scoreLegend">
                  <span>🟢 Good</span>
                  <span>🟡 Medium</span>
                  <span>🔴 Poor</span>
                </div>
              </div>

              <div className="scoreCard">
                <p>Reviews Analyzed</p>
                <strong>427 <span aria-hidden="true">📈</span></strong>
                <small>Reviews Analyzed</small>
              </div>
            </div>

            <div className="insightPreviewGrid">
              <div className="miniInsightCard">
                <h4>Top Complaints</h4>
                <MentionRow label="Business-specific themes" value="From reviews" />
                <MentionRow label="Repeated negative mentions" value="Auto-detected" />
                <MentionRow label="Only verified matches" value="No samples" />
              </div>

              <div className="miniInsightCard">
                <h4>Top Compliments</h4>
                <MentionRow label="Industry-specific strengths" value="From reviews" />
                <MentionRow label="Repeated positive mentions" value="Auto-detected" />
                <MentionRow label="Only verified matches" value="No samples" />
              </div>
            </div>

            <div className="basicSummary">
              <h4>AI Summary</h4>
              <p>
                The summary is generated from the selected business type and
                the actual review text available for that business source.
              </p>
            </div>

            <div className="lockedWall">
              Upgrade to see what is causing bad reviews, trends, AI chat,
              and recommendations.
            </div>

            <button className="planButton freeButton" onClick={() => startSignup("free")}>
              Create Free Account
            </button>
          </div>

          <div className="planPanel premiumPanel">
            <div className="planHeader">
              <div>
                <p className="planLabel goldText">Premium Plan</p>
                <h3>Full Intelligence Dashboard</h3>
                <p className="planDescription">
                  Includes sentiment scoring, review sources, complaint trends,
                  complaint breakdowns, AI insights, and automated executive reports.
                </p>
              </div>

              <span className="pricePill">
                <strong>Premium</strong>
                <small>$20/month</small>
              </span>
            </div>

            <div className="premiumVisualStack">
              <div className="premiumFeature sentimentFeature">
                <p className="featureLabel">Overall Sentiment</p>

                <div className="statStrip premiumStatStrip">
                  <div className="scoreCard">
                    <p>Customer Pulse Score</p>
                    <strong>
                      <span className="statusDot">🟢 Good</span>
                      87/100
                    </strong>

                    <div className="scoreLegend">
                      <span>🟢 Good</span>
                      <span>🟡 Medium</span>
                      <span>🔴 Poor</span>
                    </div>
                  </div>

                  <div className="scoreCard">
                    <p>Reviews Analyzed</p>
                    <strong>427 <span aria-hidden="true">📈</span></strong>
                    <small>Reviews Analyzed</small>
                  </div>
                </div>
              </div>

              <div className="premiumFeature">
                <p className="featureLabel">Review Sources</p>
                <h4>Connected review data</h4>

                <div className="sourceGrid">
                  <SourceCard source="Google Reviews" count="427" />
                  <SourceCard source="Facebook Reviews" count="Coming Soon" />
                  <SourceCard source="Yelp Reviews" count="Coming Soon" />
                  <SourceCard source="TripAdvisor" count="Coming Soon" />
                </div>
              </div>

              <div className="premiumFeature">
                <p className="featureLabel">Complaint Trends</p>
                <h4>Trends are generated from the selected business reviews after connection.</h4>
                <LineGraph />
              </div>

              <div className="premiumFeature">
                <p className="featureLabel">Complaint Breakdown</p>
                <h4>What is causing bad reviews?</h4>

                <div className="breakdownGrid">
                  <div className="donutChart">
                    <span>AI</span>
                  </div>

                  <div className="breakdownList">
                    <BreakdownRow color="dark" label="Top review theme" value="Review-driven" />
                    <BreakdownRow color="gold" label="Second review theme" value="Review-driven" />
                    <BreakdownRow color="light" label="Third review theme" value="Review-driven" />
                  </div>
                </div>

                <p className="featureNote">
                  Negative review themes appear only when the selected business reviews mention them.
                </p>
              </div>

              <div className="premiumFeature">
                <p className="featureLabel">Top Compliments</p>
                <h4>What customers praise most</h4>

                <BarRow label="Top review strength" value="Review-driven" width="92%" />
                <BarRow label="Second review strength" value="Review-driven" width="78%" />
                <BarRow label="Third review strength" value="Review-driven" width="48%" />
              </div>

              <div className="premiumFeature reportFeature">
                <p className="featureLabel">Executive Reports Preview</p>
                <h4>Email Reports Included</h4>
                <p className="featureNote">Choose Daily, Weekly, or Monthly Reports</p>

                <div className="reportMock">
                  <div className="reportLine good">Customers love: detected from reviews</div>
                  <div className="reportLine bad">Customers mention: detected from reviews</div>
                  <div className="reportLine">Needs attention: generated from review themes</div>
                  <div className="reportLine">Business type: detected from Google Places</div>
                </div>
              </div>
            </div>

            <button className="planButton premiumButton" onClick={() => startSignup("premium")}>
              Upgrade to Premium
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ResultsPage({ results, source, chooseBusiness, setPage }) {
  return (
    <section className="page">
      <button className="backHomeButton" onClick={() => setPage("home")}>
        Back to Home
      </button>
      <p className="eyebrow">Confirm your business</p>
      <h1>Select the correct listing</h1>
      <p className="muted">
        Review Intel Care will only show insights after you confirm the right business.
      </p>
      <p className="resultsCount">
        Showing {results.length} matching {results.length === 1 ? "business" : "businesses"}.
      </p>

      {source === "fallback" && (
        <p className="fallbackNotice">
          Showing fallback results because Google Places is not available. Add a real backend Google Places API key for live results.
        </p>
      )}

      {results.length === 0 ? (
        <div className="emptyResults">
          <h2>No matching Google businesses found.</h2>
          <p>Try searching with a more specific business name or city.</p>
          <button onClick={() => setPage("home")}>Search Again</button>
        </div>
      ) : (
        <div className="resultScroller">
          <div className="resultGrid">
            {results.map((business) => (
              <div className="businessCard" key={business.placeId}>
                <p className="category">{business.category || "Google Business Profile"}</p>
                <h2>{business.name ?? business.displayName}</h2>
                <p>{business.address ?? business.formattedAddress}</p>
                <p>
                  Rating: {business.rating ?? "N/A"} <span aria-hidden="true">·</span> Reviews: {business.reviewCount ?? 0}
                </p>
                <small>Google Place ID will be saved for review analysis.</small>
                <button onClick={() => chooseBusiness(business)}>
                  This Is My Business
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
function SignupPage({ selectedPlan, setSelectedPlan, setPage }) {
  return (
    <section className="signupPage">
      <div className="signupCard">
        <p className="eyebrow">Account Setup</p>
        <h1>Create your Review Intel Care account</h1>
        <p className="signupText">
          Choose a plan, enter your account details, and continue to your dashboard.
        </p>

        <div className="signupForm">
          <input placeholder="Full name" />
          <input placeholder="Email address" />
          <input placeholder="Password" type="password" />
          <input placeholder="Business name" />
        </div>

        <div className="signupPlans">
          <button
            className={selectedPlan === "free" ? "selectedPlan" : ""}
            onClick={() => setSelectedPlan("free")}
          >
            <strong>Free</strong>
            <span>$0/month</span>
          </button>

          <button
            className={selectedPlan === "premium" ? "selectedPlan" : ""}
            onClick={() => setSelectedPlan("premium")}
          >
            <strong>Premium</strong>
            <span>$20/month</span>
          </button>
        </div>

        <button
          className="signupPrimary"
          onClick={() => setPage(selectedPlan === "premium" ? "checkout" : "success")}
        >
          Continue
        </button>

        <button className="signupSecondary" onClick={() => setPage("home")}>
          Back to Home
        </button>
      </div>
    </section>
  );
}

function CheckoutPage({ selectedPlan, setPage }) {
  return (
    <section className="signupPage">
      <div className="signupCard">
        <p className="eyebrow">Checkout</p>
        <h1>Start Premium</h1>
        <p className="signupText">
          This is a frontend-only checkout screen. Backend payment will be added later.
        </p>

        <div className="checkoutSummary">
          <div>
            <span>Selected Plan</span>
            <strong>{selectedPlan === "premium" ? "Premium" : "Free"}</strong>
          </div>

          <div>
            <span>Total Due Today</span>
            <strong>{selectedPlan === "premium" ? "$20.00" : "$0.00"}</strong>
          </div>
        </div>

        <div className="paymentBox">
          <input placeholder="Card number" />
          <div>
            <input placeholder="MM/YY" />
            <input placeholder="CVC" />
          </div>
          <input placeholder="Billing ZIP code" />
        </div>

        <button className="signupPrimary" onClick={() => setPage("success")}>
          Start Premium
        </button>

        <button className="signupSecondary" onClick={() => setPage("signup")}>
          Back
        </button>
      </div>
    </section>
  );
}

function SuccessPage({ selectedPlan, continueToDashboard }) {
  return (
    <section className="signupPage">
      <div className="signupCard successCard">
        <div className="successIcon">✓</div>
        <p className="eyebrow">Account Created</p>
        <h1>Your Review Intel Care account is ready</h1>
        <p className="signupText">
          Your {selectedPlan === "premium" ? "Premium" : "Free"} account is ready.
        </p>

        <button className="signupPrimary" onClick={continueToDashboard}>
          Continue to Dashboard
        </button>
      </div>
    </section>
  );
}

function FreeDashboard({ business, insights, insightStatus, insightError, googleUserId, startSignup, signOut }) {
  const googlePlace = insights?.place ?? {};
  const dashboardBusiness = {
    ...business,
    ...googlePlace,
    name: googlePlace.name ?? business.name,
    address: googlePlace.address ?? business.address,
    location: googlePlace.address ?? business.location,
    category: googlePlace.category ?? business.category,
    rating: insights?.rating ?? business.rating,
    reviewCount: insights?.reviewCount ?? business.reviewCount ?? business.reviews ?? 0,
  };
  const fallbackPulseScore = getPulseScoreFromRating(dashboardBusiness.rating);
  const pulseScore = insights?.pulseScore ?? fallbackPulseScore;
  const pulseLabel = insights?.pulseLabel ?? getPulseLabel(pulseScore);
  const pulseDisplay =
    insightStatus === "loading"
      ? "Loading..."
      : pulseScore === null
        ? pulseLabel
        : `${pulseLabel} ${pulseScore}/100`;
  const complaintItems =
    insights?.topComplaints?.map((theme) => `${theme.label} - ${theme.value}`) ?? [];
  const complimentItems =
    insights?.topCompliments?.map((theme) => `${theme.label} - ${theme.value}`) ?? [];
  const limitedMessage = googleUserId
    ? ""
    : "The Free Snapshot shows limited review data. Upgrade to Premium to unlock complete review intelligence and AI-powered analysis.";
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const totalGoogleReviews = dashboardBusiness.reviewCount;
  const analyzedReviewTexts = insights?.reviewsAnalyzed ?? 0;
  const aiSummary =
    insights?.aiSummary ??
    (insightStatus === "loading"
      ? "Loading review insights..."
      : "Review insights could not be loaded yet. Try again after confirming the backend is running.");

  return (
    <section className="dashboardPage">
      <div className="dashboardHeader">
        <div>
          <p className="eyebrow">Free Review Snapshot</p>
          <h1>{dashboardBusiness.name}</h1>
          <p className="muted">
            {dashboardBusiness.category && (
              <>
                {dashboardBusiness.category} <span aria-hidden="true">·</span>{" "}
              </>
            )}
            {dashboardBusiness.location} <span aria-hidden="true">·</span> Rating: {dashboardBusiness.rating ?? "N/A"} <span aria-hidden="true">·</span> {dashboardBusiness.reviewCount} reviews
          </p>
          {limitedMessage && <p className="limitedReviewNotice">{limitedMessage}</p>}
          {insightError && <p className="searchError">{insightError}</p>}
        </div>

        <div className="freeHeaderActions">
          <button className="goldButton" onClick={() => startSignup("premium")}>
            Unlock Premium
          </button>
          <button className="freeSignOutButton" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="freeDashboardGrid">
        <div className="metricCard">
          <p>Customer Pulse Score</p>
          <h2><span className="metricIcon good"></span>{pulseDisplay}</h2>
        </div>

        <div className="metricCard">
          <p>{googleUserId ? "Reviews Analyzed" : "Public Review Texts Available"}</p>
          <h2><span className="metricIcon chart">📈</span>{analyzedReviewTexts}</h2>
          {insights && (
            <small>
              {googleUserId
                ? `${analyzedReviewTexts} of ${totalGoogleReviews} reviews analyzed`
                : `${totalGoogleReviews} total reviews found. The Free Snapshot analyzes only a limited sample. Upgrade to Premium to analyze all available reviews, uncover trends, and unlock deeper AI insights.`}
            </small>
          )}
        </div>
      </div>

      <div className="dashboardColumns">
        <InsightBox
          title="Top Complaints"
          items={complaintItems}
          emptyMessage={
            insightStatus === "loading"
              ? "Scanning available reviews..."
              : notEnoughMessage
          }
        />

        <InsightBox
          title="Top Compliments"
          items={complimentItems}
          emptyMessage={
            insightStatus === "loading"
              ? "Scanning available reviews..."
              : notEnoughMessage
          }
        />
      </div>

      <div className="summaryPanel">
        <h2>AI Summary</h2>
        <p>{aiSummary}</p>
      </div>

      <div className="upgradePanel">
        <h2>Premium answers the questions that matter.</h2>
        <p>
          Upgrade to Premium to analyze all available reviews and unlock advanced sentiment tracking, trend analysis, AI recommendations, and executive-level insights.
        </p>
        <button onClick={() => startSignup("premium")}>Sign Up for Premium</button>
      </div>
    </section>
  );
}

function PremiumDashboard({ business, insights, insightStatus, insightError, googleUserId, signOut }) {
  const [activeSection, setActiveSection] = useState("overview");

  return (
    <section className="premiumDashboard">
      <aside className="sidebar">
        <h2>REVIEW INTEL CARE</h2>

        <button
          className={activeSection === "overview" ? "active" : ""}
          onClick={() => setActiveSection("overview")}
        >
          Overview
        </button>

        <button
          className={activeSection === "sentiment" ? "active" : ""}
          onClick={() => setActiveSection("sentiment")}
        >
          Sentiment
        </button>

        <button
          className={activeSection === "reviews" ? "active" : ""}
          onClick={() => setActiveSection("reviews")}
        >
          Reviews
        </button>

        <button
          className={activeSection === "trends" ? "active" : ""}
          onClick={() => setActiveSection("trends")}
        >
          Trends
        </button>
        <button
          className={activeSection === "sources" ? "active" : ""}
          onClick={() => setActiveSection("sources")}
        >
          Sources
        </button>
        <button
          className={activeSection === "reports" ? "active" : ""}
          onClick={() => setActiveSection("reports")}
        >
          Reports
        </button>

        <button className="signOutButton" onClick={signOut}>
          Sign Out
        </button>
      </aside>

      <main className="premiumContent">
        {activeSection === "overview" && <OverviewView business={business} insights={insights} insightStatus={insightStatus} insightError={insightError} googleUserId={googleUserId} />}
        {activeSection === "sentiment" && <SentimentView business={business} insights={insights} />}
        {activeSection === "reviews" && <ReviewsView business={business} insights={insights} />}
        {activeSection === "trends" && <TrendsView business={business} insights={insights} />}
        {activeSection === "sources" && <SourcesView business={business} insights={insights} />}
        {activeSection === "reports" && <ReportsView business={business} insights={insights} />}
      </main>
    </section>
  );
}

function OverviewView({ business, insights, insightStatus, insightError, googleUserId }) {
  const reviewCount = insights?.reviewCount ?? business.reviewCount ?? business.reviews ?? 0;
  const pulseScore = insights?.pulseScore ?? getPulseScoreFromRating(insights?.rating ?? business.rating);
  const pulseLabel = insights?.pulseLabel ?? getPulseLabel(pulseScore);
  const sentimentBreakdown = insights?.sentimentBreakdown ?? { positive: 0, neutral: 0, negative: 0 };
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const complimentThemes = insights?.topCompliments ?? [];
  const complaintThemes = insights?.topComplaints ?? [];
  const strongestComplaint = complaintThemes[0];
  const complaintPercent =
    strongestComplaint && insights?.reviewsAnalyzed
      ? `${Math.round((strongestComplaint.count / insights.reviewsAnalyzed) * 100)}%`
      : "0%";

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Premium Intelligence Dashboard</p>
          <h1>{business.name}</h1>
          <p className="muted">
            {business.location} <span aria-hidden="true">·</span> {reviewCount} reviews <span aria-hidden="true">·</span> {insights?.businessType ?? business.category}
          </p>
          {!googleUserId && (
            <p className="limitedReviewNotice">
              Google Places only provides a limited public review sample. Connect Google Business Profile to analyze all Google reviews.
            </p>
          )}
          {insightError && <p className="searchError">{insightError}</p>}
        </div>

        <div className="overviewSentimentSummary">
          <span>Overall Sentiment</span>
          <div className="overviewSentimentInner">
            <div className="overviewScore">
              <strong><i></i>{insightStatus === "loading" ? "Loading" : pulseLabel}</strong>
              <b>{pulseScore === null || pulseScore === undefined ? "N/A" : `${pulseScore}/100`}</b>
            </div>

            <div className="overviewLegend">
              <span><i className="goodDot"></i>{sentimentBreakdown.positive} Positive</span>
              <span><i className="mediumDot"></i>{sentimentBreakdown.neutral} Neutral</span>
              <span><i className="poorDot"></i>{sentimentBreakdown.negative} Negative</span>
            </div>
          </div>
        </div>
      </div>

      <div className="premiumDashboardGrid">
        <DashboardWidget title="Review Sources" className="sourcesWidget">
          <div className="sourceGrid dashboardSources">
            <SourceCard source="Google Reviews" count={reviewCount || "Coming Soon"} />
            <SourceCard source="Facebook Reviews" count="Coming Soon" />
            <SourceCard source="Yelp Reviews" count="Coming Soon" />
            <SourceCard source="TripAdvisor" count="Coming Soon" />
          </div>
        </DashboardWidget>

        <DashboardWidget title="Top Compliments" className="complimentsWidget">
          {complimentThemes.length ? (
            complimentThemes.map((theme) => (
              <BarRow key={theme.label} label={theme.label} value={theme.value} width={`${Math.max(18, theme.count * 28)}%`} />
            ))
          ) : (
            <p className="emptyInsightMessage">{notEnoughMessage}</p>
          )}
        </DashboardWidget>

        <DashboardWidget title="Complaint Breakdown" className="breakdownWidget">
          <div className="breakdownGrid">
            <div className="donutChart">
              <span>{complaintPercent}</span>
            </div>
            <div className="breakdownList">
              {complaintThemes.length ? (
                complaintThemes.map((theme, index) => (
                  <BreakdownRow
                    key={theme.label}
                    color={index === 0 ? "dark" : index === 1 ? "gold" : "light"}
                    label={theme.label}
                    value={theme.value}
                  />
                ))
              ) : (
                <p className="emptyInsightMessage">{notEnoughMessage}</p>
              )}
            </div>
          </div>
        </DashboardWidget>

        <DashboardWidget title="Complaint Trends" className="trendsWidget">
          <p className="alert">{insights?.trendSummary ?? notEnoughMessage}</p>
          <LineGraph />
        </DashboardWidget>

        <DashboardWidget title="Executive Reports Preview" className="reportsPreviewWidget">
          <h3>Email Reports Included</h3>
          <p>Choose Daily, Weekly, or Monthly Reports</p>

          <div className="reportMock">
            <div className="reportLine good">Customers love: {complimentThemes[0]?.label ?? notEnoughMessage}</div>
            <div className="reportLine bad">Customers mention: {complaintThemes[0]?.label ?? notEnoughMessage}</div>
            <div className="reportLine">Recommendation: {insights?.recommendation ?? notEnoughMessage}</div>
            <div className="reportLine">Business type: {insights?.businessType ?? business.category ?? "Unknown"}</div>
          </div>
        </DashboardWidget>
        <DashboardWidget title="Customer Reviews Feed" className="reviewsFeedWidget">
          <div className="reviewsScrollBox">
            {insights?.recentReviews?.length ? (
              insights.recentReviews.map((review, index) => (
                <ReviewItem
                  key={`${review.publishTime ?? "review"}-${index}`}
                  source={getSourceLabel(review.source)}
                  rating={review.rating ?? 0}
                  text={review.text}
                />
              ))
            ) : (
              <p className="emptyInsightMessage">{notEnoughMessage}</p>
            )}
          </div>
        </DashboardWidget>
      </div>
    </>
  );
}

function ReviewsView({ business, insights }) {
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Reviews</p>
          <h1>Review Explorer</h1>
          <p className="muted">
            Search, filter, and review customer feedback for {business.name}.
          </p>
        </div>
      </div>

      <div className="reviewsTools">
        <input placeholder="Search reviews by keyword, complaint, or compliment..." />

        <div className="filterRow">
          <button>Google</button>
        </div>

        <div className="filterRow">
          <button>All Ratings</button>
          <button>5 Stars</button>
          <button>4 Stars</button>
          <button>3 Stars</button>
          <button>1-2 Stars</button>
        </div>
      </div>

      <div className="reviewsPageGrid">
        {insights?.recentReviews?.length ? (
          insights.recentReviews.map((review, index) => (
            <ReviewItem
              key={`${review.publishTime ?? "review"}-${index}`}
              source={getSourceLabel(review.source)}
              rating={review.rating ?? 0}
              text={review.text}
            />
          ))
        ) : (
          <p className="emptyInsightMessage">{notEnoughMessage}</p>
        )}
      </div>
    </>
  );
}

function SentimentView({ business, insights }) {
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const sentiment = insights?.sentimentBreakdown ?? { positive: 0, neutral: 0, negative: 0 };
  const totalSentiment = sentiment.positive + sentiment.neutral + sentiment.negative;
  const percent = (value) => (totalSentiment ? `${Math.round((value / totalSentiment) * 100)}%` : "0%");
  const pulseScore = insights?.pulseScore ?? getPulseScoreFromRating(insights?.rating ?? business.rating);

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Sentiment</p>
          <h1>Customer Sentiment</h1>
          <p className="muted">
            Positive, neutral, and negative review patterns for {business.name}.
          </p>
        </div>
      </div>

      <div className="sentimentPageGrid">
        <DashboardWidget title="Positive / Neutral / Negative Breakdown">
          <div className="sentimentBreakdown">
            <div className="sentimentDonut">
              <span>{pulseScore === null || pulseScore === undefined ? "N/A" : `${pulseScore}%`}</span>
            </div>

            <div className="sentimentBars">
              <SentimentBar
                tone="positive"
                label="Positive"
                value={percent(sentiment.positive)}
                width={percent(sentiment.positive)}
                detail={`${sentiment.positive} reviews`}
              />
              <SentimentBar
                tone="neutral"
                label="Neutral"
                value={percent(sentiment.neutral)}
                width={percent(sentiment.neutral)}
                detail={`${sentiment.neutral} reviews`}
              />
              <SentimentBar
                tone="negative"
                label="Negative"
                value={percent(sentiment.negative)}
                width={percent(sentiment.negative)}
                detail={`${sentiment.negative} reviews`}
              />
            </div>
          </div>
        </DashboardWidget>

        <div className="sentimentPhraseGrid">
          <DashboardWidget title="Most Positive Phrases">
            {insights?.topCompliments?.length ? (
              insights.topCompliments.map((theme) => (
                <PhraseRow key={theme.label} phrase={theme.label} count={theme.value} tone="positive" />
              ))
            ) : (
              <p className="emptyInsightMessage">{notEnoughMessage}</p>
            )}
          </DashboardWidget>

          <DashboardWidget title="Most Negative Phrases">
            {insights?.topComplaints?.length ? (
              insights.topComplaints.map((theme) => (
                <PhraseRow key={theme.label} phrase={theme.label} count={theme.value} tone="negative" />
              ))
            ) : (
              <p className="emptyInsightMessage">{notEnoughMessage}</p>
            )}
          </DashboardWidget>
        </div>

        <DashboardWidget title="Sentiment Summary">
          <div className="sentimentSummary">
            <strong>{insights?.businessType ? `${business.name} is categorized as a ${insights.businessType}.` : notEnoughMessage}</strong>
            <p>{insights?.aiSummary ?? notEnoughMessage}</p>
          </div>
        </DashboardWidget>
      </div>
    </>
  );
}

function TrendsView({ business, insights }) {
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const rating = insights?.rating ?? business.rating ?? 0;
  const reviewCount = insights?.reviewCount ?? business.reviewCount ?? business.reviews ?? 0;
  const complaintCount = insights?.topComplaints?.reduce((total, theme) => total + theme.count, 0) ?? 0;

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Trends</p>
          <h1>Review Trends</h1>
          <p className="muted">
            Track review volume, average rating, and complaint activity for {business.name}.
          </p>
        </div>
      </div>

      <div className="trendsPageGrid">
        <DashboardWidget title="Review Trend Graph">
          <p className="trendNote">{insights?.trendSummary ?? notEnoughMessage}</p>
          <TrendLineGraph
            values={[reviewCount]}
            labels={["Google"]}
            max={Math.max(10, reviewCount)}
            suffix=""
          />
        </DashboardWidget>

        <DashboardWidget title="Rating Trend Graph">
          <p className="trendNote">Current Google rating from the selected business profile.</p>
          <TrendLineGraph
            values={[rating]}
            labels={["Google"]}
            min={3.8}
            max={4.8}
            suffix=""
          />
        </DashboardWidget>

        <DashboardWidget title="Complaint Trend Graph">
          <p className="trendNote">{complaintCount ? `${complaintCount} complaint theme mentions found in available review text.` : notEnoughMessage}</p>
          <TrendLineGraph
            values={[complaintCount]}
            labels={["Available"]}
            max={Math.max(5, complaintCount)}
            suffix=""
          />
        </DashboardWidget>
      </div>
    </>
  );
}

function SourcesView({ business, insights }) {
  const reviewCount = insights?.reviewCount ?? business.reviewCount ?? business.reviews ?? 0;
  const sourceBreakdown = insights?.sourceBreakdown ?? { google_places: reviewCount };
  const sourceEntries = Object.entries(sourceBreakdown);
  const totalSourceReviews = sourceEntries.reduce((total, [, count]) => total + count, 0) || reviewCount || 1;
  const firstSource = sourceEntries[0]?.[0] ?? "google_places";

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Sources</p>
          <h1>Review Sources</h1>
          <p className="muted">
            Analyze all normalized reviews together by default. Source filtering can be added here without changing the review table.
          </p>
        </div>
      </div>

      <div className="sourcesPageGrid">
        <DashboardWidget title="Review Source Breakdown">
          <div className="sourceBreakdownGrid">
            {sourceEntries.map(([source, count]) => (
              <SourceBreakdownCard
                key={source}
                source={getSourceLabel(source)}
                count={count}
                percent={`${Math.round((count / totalSourceReviews) * 100)}%`}
              />
            ))}
          </div>
        </DashboardWidget>

        <div className="sourcesComparisonGrid">
          <DashboardWidget title="Rating by Source">
            <SourceMetricRow source={getSourceLabel(firstSource)} value={business.rating ?? "N/A"} width="100%" />
          </DashboardWidget>

          <DashboardWidget title="Review Count by Source">
            {sourceEntries.map(([source, count]) => (
              <SourceMetricRow
                key={source}
                source={getSourceLabel(source)}
                value={count}
                width={`${Math.max(8, Math.round((count / totalSourceReviews) * 100))}%`}
              />
            ))}
          </DashboardWidget>
        </div>
      </div>
    </>
  );
}

function ReportsView({ business, insights }) {
  const [selectedReport, setSelectedReport] = useState("Weekly");
  const [selectedNotification, setSelectedNotification] = useState("Weekly");
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const topCompliment = insights?.topCompliments?.[0]?.label ?? notEnoughMessage;
  const topComplaint = insights?.topComplaints?.[0]?.label ?? notEnoughMessage;

  const reportOptions = [
    {
      title: "Daily",
      cadence: "Every morning",
      description: "A short pulse report covering yesterday's reviews, urgent complaints, and rating changes.",
    },
    {
      title: "Weekly",
      cadence: "Every Monday",
      description: "A manager summary with source performance, sentiment shifts, and top action items.",
    },
    {
      title: "Monthly",
      cadence: "First day of month",
      description: "An executive rollup with trends, complaint categories, source comparison, and recommendations.",
    },
  ];

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Executive Reports</h1>
          <p className="muted">
            Choose report timing, preview the email summary, and prepare exports for {business.name}.
          </p>
        </div>
      </div>

      <div className="reportsPageGrid">
        <DashboardWidget title="Daily / Weekly / Monthly Report Options">
          <div className="reportOptionGrid">
            {reportOptions.map((option) => (
              <ReportOption
                key={option.title}
                title={option.title}
                cadence={option.cadence}
                description={option.description}
                selected={selectedReport === option.title}
                onSelect={() => setSelectedReport(option.title)}
              />
            ))}
          </div>
        </DashboardWidget>

        <DashboardWidget title="Email Report Preview">
          <div className="emailPreview">
            <div className="emailHeader">
              <span>To: owner@palmbusiness.com</span>
              <span>Subject: {selectedReport} Review Intel Care Report</span>
            </div>

            <div className="emailBody">
              <h3>{business.name} {selectedReport} Review Summary</h3>
              <p>{insights?.aiSummary ?? notEnoughMessage}</p>

              <div className="reportMock">
                <div className="reportLine good">Customers mention positively: {topCompliment}</div>
                <div className="reportLine bad">Customers mention negatively: {topComplaint}</div>
                <div className="reportLine">Recommendation: {insights?.recommendation ?? notEnoughMessage}</div>
                <div className="reportLine">Business type: {insights?.businessType ?? business.category ?? "Unknown"}</div>
              </div>
            </div>
          </div>
        </DashboardWidget>

        <DashboardWidget title="Download / Export Options">
          <div className="selectedExport">
            Selected export: <strong>{selectedReport} report</strong>
          </div>
          <div className="exportActions">
            <button>Download {selectedReport} PDF</button>
            <button>Export {selectedReport} CSV</button>
            <button>Email {selectedReport} Report</button>
          </div>
          <p className="exportNote">
            Export buttons are placeholders for now. Backend report generation can connect here later.
          </p>
        </DashboardWidget>

        <DashboardWidget title="Email Notification Setup">
          <div className="notificationSetup">
            <div>
              <label htmlFor="reportEmail">Send review performance reports to</label>
              <input id="reportEmail" placeholder="owner@palmbusiness.com" />
            </div>

            <div>
              <p className="notificationLabel">Choose email notification frequency</p>
              <div className="notificationToggleGrid">
                {reportOptions.map((option) => (
                  <button
                    className={selectedNotification === option.title ? "notificationToggle active" : "notificationToggle"}
                    key={option.title}
                    onClick={() => setSelectedNotification(option.title)}
                    type="button"
                  >
                    <span>{option.title}</span>
                    <strong>{selectedNotification === option.title ? "Selected" : "Choose"}</strong>
                    <small>{option.cadence}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="selectedExport">
              Email notifications: <strong>{selectedNotification}</strong>
            </div>

            <button className="enrollButton" type="button">
              Enroll in {selectedNotification} Email Notifications
            </button>
          </div>
        </DashboardWidget>
      </div>
    </>
  );
}

function LineGraph() {
  return (
    <div className="fixedLineChart">
      <svg viewBox="0 0 700 330" className="fixedLineSvg">
        <line x1="70" y1="40" x2="70" y2="260" />
        <line x1="70" y1="260" x2="650" y2="260" />

        <line x1="70" y1="40" x2="650" y2="40" className="grid" />
        <line x1="70" y1="84" x2="650" y2="84" className="grid" />
        <line x1="70" y1="128" x2="650" y2="128" className="grid" />
        <line x1="70" y1="172" x2="650" y2="172" className="grid" />
        <line x1="70" y1="216" x2="650" y2="216" className="grid" />
        <line x1="70" y1="260" x2="650" y2="260" className="grid" />

        <text x="28" y="45">50</text>
        <text x="28" y="89">40</text>
        <text x="28" y="133">30</text>
        <text x="28" y="177">20</text>
        <text x="28" y="221">10</text>
        <text x="36" y="265">0</text>

        <polyline
          points="145,207 295,154 445,80 595,112"
          fill="none"
          stroke="#111411"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle cx="145" cy="207" r="13" />
        <circle cx="295" cy="154" r="13" />
        <circle cx="445" cy="80" r="13" />
        <circle cx="595" cy="112" r="13" />

        <text x="145" y="187" className="valueText">12</text>
        <text x="295" y="134" className="valueText">24</text>
        <text x="445" y="60" className="valueText">41</text>
        <text x="595" y="92" className="valueText">34</text>

        <text x="145" y="305" className="monthText">Jan</text>
        <text x="295" y="305" className="monthText">Feb</text>
        <text x="445" y="305" className="monthText">Mar</text>
        <text x="595" y="305" className="monthText">Apr</text>
      </svg>
    </div>
  );
}

function TrendLineGraph({ values, labels, min = 0, max, suffix }) {
  const chartMax = max ?? Math.max(...values);
  const chartMin = min;
  const range = chartMax - chartMin || 1;
  const xStart = 70;
  const xEnd = 650;
  const yTop = 40;
  const yBottom = 260;
  const xStep = (xEnd - xStart) / (values.length - 1);

  const points = values
    .map((value, index) => {
      const x = xStart + xStep * index;
      const y = yBottom - ((value - chartMin) / range) * (yBottom - yTop);
      return `${x},${y}`;
    })
    .join(" ");

  const yTicks = [chartMax, chartMin + range * 0.75, chartMin + range * 0.5, chartMin + range * 0.25, chartMin];

  return (
    <div className="fixedLineChart trendChart">
      <svg viewBox="0 0 700 330" className="fixedLineSvg">
        <line x1="70" y1="40" x2="70" y2="260" />
        <line x1="70" y1="260" x2="650" y2="260" />

        {yTicks.map((tick, index) => {
          const y = yTop + ((yBottom - yTop) / (yTicks.length - 1)) * index;
          return (
            <g key={tick}>
              <line x1="70" y1={y} x2="650" y2={y} className="grid" />
              <text x="26" y={y + 5}>{formatTrendValue(tick, suffix)}</text>
            </g>
          );
        })}

        <polyline
          points={points}
          fill="none"
          stroke="#111411"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {values.map((value, index) => {
          const x = xStart + xStep * index;
          const y = yBottom - ((value - chartMin) / range) * (yBottom - yTop);

          return (
            <g key={`${labels[index]}-${value}`}>
              <circle cx={x} cy={y} r="13" />
              <text x={x} y={y - 20} className="valueText">
                {formatTrendValue(value, suffix)}
              </text>
              <text x={x} y="305" className="monthText">
                {labels[index]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatTrendValue(value, suffix) {
  const roundedValue = Number.isInteger(value) ? value : value.toFixed(1);
  return `${roundedValue}${suffix}`;
}

function ReviewItem({ source, rating = 0, text }) {
  const stars = "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));

  return (
    <div className="reviewItem">
      <div className="reviewTop">
        <span className="reviewSource">{source}</span>
        <span className="reviewStars">{stars}</span>
      </div>
      <p>{text}</p>
    </div>
  );
}

function MentionRow({ label, value }) {
  return (
    <div className="mentionRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourceCard({ source, count }) {
  const icons = {
    "Google Reviews": "G",
    "Google Places": "G",
    "Google Business Profile": "G",
    "Facebook Reviews": "F",
    Facebook: "F",
    "Yelp Reviews": "Y",
    Yelp: "Y",
    TripAdvisor: "T",
    Instagram: "I",
    "App Store": "A",
  };

  return (
    <div className="sourceCard">
      <div className="sourceTop">
        <span className="sourceIcon">{icons[source] ?? source.slice(0, 1).toUpperCase()}</span>
        <span>{source}</span>
      </div>
      <strong>{count}</strong>
    </div>
  );
}

function SourceBreakdownCard({ source, count, percent }) {
  const icons = {
    "Google Places": "G",
    "Google Business Profile": "G",
    Facebook: "F",
    Yelp: "Y",
    TripAdvisor: "T",
    Instagram: "I",
    "App Store": "A",
  };

  return (
    <div className="sourceBreakdownCard">
      <div className="sourceTop">
        <span className="sourceIcon">{icons[source] ?? source.slice(0, 1).toUpperCase()}</span>
        <span>{source}</span>
      </div>
      <strong>{percent}</strong>
      <small>{count} reviews</small>
    </div>
  );
}

function SourceMetricRow({ source, value, width }) {
  return (
    <div className="sourceMetricRow">
      <div>
        <span>{source}</span>
        <strong>{value}</strong>
      </div>
      <div className="sourceMetricTrack">
        <div style={{ width }}></div>
      </div>
    </div>
  );
}

function ReportOption({ title, cadence, description, selected, onSelect }) {
  return (
    <button
      className={selected ? "reportOption selected" : "reportOption"}
      onClick={onSelect}
      type="button"
    >
      <div>
        <strong>{title}</strong>
        <span>{selected ? "Selected" : cadence}</span>
      </div>
      <p>{description}</p>
    </button>
  );
}

function BreakdownRow({ color, label, value }) {
  return (
    <div className="breakdownRow">
      <span className={`legendDot ${color}`}></span>
      <p>{label}</p>
      <div className="breakdownBarTrack">
        <div style={{ width: value?.includes("mention") ? "75%" : "60%" }}></div>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function BarRow({ label, value, width }) {
  return (
    <div className="barRow">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="barTrack">
        <div style={{ width }}></div>
      </div>
    </div>
  );
}

function SentimentBar({ tone, label, value, width, detail }) {
  return (
    <div className="sentimentBar">
      <div>
        <span className={`sentimentDot ${tone}`}></span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>

      <div className="sentimentTrack">
        <div className={tone} style={{ width }}></div>
      </div>

      <strong>{value}</strong>
    </div>
  );
}

function PhraseRow({ phrase, count, tone }) {
  return (
    <div className="phraseRow">
      <span className={tone}>{phrase}</span>
      <strong>{count}</strong>
    </div>
  );
}

function DashboardWidget({ title, children, className = "" }) {
  return (
    <div className={`dashboardWidget ${className}`.trim()}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function InsightBox({ title, items, emptyMessage }) {
  return (
    <div className="insightBox">
      <h2>{title}</h2>
      {items.length > 0 ? (
        items.map((item, index) => (
          <div className="insightItem" key={index}>
            <span>{index + 1}</span>
            <p>{item}</p>
          </div>
        ))
      ) : (
        <p className="emptyInsightMessage">{emptyMessage}</p>
      )}
    </div>
  );
}

export default App;

