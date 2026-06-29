import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.reviewintelcare.com";
const SELECTED_BUSINESS_STORAGE_KEY = "selectedBusiness";
const SELECTED_PLACE_ID_STORAGE_KEY = "selectedGooglePlaceId";
const GOOGLE_USER_ID_STORAGE_KEY = "googleBusinessUserId";
const AUTH_TOKEN_STORAGE_KEY = "reviewIntelAuthToken";
const AUTH_USER_STORAGE_KEY = "reviewIntelAuthUser";

function loadSelectedBusiness() {
  try {
    const savedBusiness = localStorage.getItem(SELECTED_BUSINESS_STORAGE_KEY);
    return savedBusiness ? JSON.parse(savedBusiness) : null;
  } catch (error) {
    console.warn("Unable to load selected business from localStorage.", error);
    return null;
  }
}

function loadAuthUser() {
  try {
    const savedUser = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    return savedUser ? JSON.parse(savedUser) : null;
  } catch (error) {
    console.warn("Unable to load signed-in user from localStorage.", error);
    return null;
  }
}

function loadAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

function saveAuthSession({ user, token }) {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
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

function getMonthlyTrendSeries(insights) {
  const monthlyReviewCounts = insights?.trends?.monthlyReviewCounts;

  if (!monthlyReviewCounts) {
    return null;
  }

  const entries = Object.entries(monthlyReviewCounts).sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    return null;
  }

  return {
    values: entries.map(([, count]) => Number(count) || 0),
    labels: entries.map(([month]) => month),
  };
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
  const [page, setPage] = useState("home");
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
  const [googleBusinessStatus, setGoogleBusinessStatus] = useState("idle");
  const [googleBusinessMessage, setGoogleBusinessMessage] = useState("");
  const [googleBusinessLocations, setGoogleBusinessLocations] = useState([]);
  const [selectedGoogleLocationName, setSelectedGoogleLocationName] = useState("");
  const [authToken, setAuthToken] = useState(() => loadAuthToken());
  const [currentUser, setCurrentUser] = useState(() => loadAuthUser());
  const [authStatus, setAuthStatus] = useState("idle");
  const [authError, setAuthError] = useState("");
  const [billingStatus, setBillingStatus] = useState("idle");
  const [billingError, setBillingError] = useState("");
  const [billingMessage, setBillingMessage] = useState("");
  const [reviewInsights, setReviewInsights] = useState(null);
  const [insightStatus, setInsightStatus] = useState("idle");
  const [insightError, setInsightError] = useState("");

  useEffect(() => {
    if (!authToken) {
      return;
    }

    const controller = new AbortController();

    async function loadCurrentUser() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
          headers: { Authorization: `Bearer ${authToken}` },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Session expired.");
        }

        const data = await response.json();
        setCurrentUser(data.user);
        localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(data.user));
      } catch (error) {
        if (error.name === "AbortError") return;
        clearAuthSession();
        setAuthToken(null);
        setCurrentUser(null);
        if (page === "free" || page === "premium") {
          setPage("signin");
        }
      }
    }

    loadCurrentUser();

    return () => controller.abort();
  }, [authToken, page]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleConnected = params.get("googleConnected");

    if (!googleConnected) {
      return;
    }

    window.history.replaceState({}, "", window.location.pathname);

    if (googleConnected === "true") {
      setGoogleBusinessStatus("connected");
      setGoogleBusinessMessage("Google Business Profile connected. You can sync full Google reviews now.");

      if (authToken) {
        fetch(`${API_BASE_URL}/api/auth/session`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message ?? "Unable to refresh Google connection.");
            setCurrentUser(data.user);
            localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(data.user));
          })
          .catch((error) => {
            setGoogleBusinessStatus("error");
            setGoogleBusinessMessage(error.message);
          });
      }
      return;
    }

    setGoogleBusinessStatus("error");
    setGoogleBusinessMessage("Google Business Profile was not connected. Please try again.");
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get("checkout");
    const sessionId = params.get("session_id");

    if (!checkoutStatus) {
      return;
    }

    window.history.replaceState({}, "", window.location.pathname);

    async function handleCheckoutReturn() {
      if (checkoutStatus === "canceled") {
        setBillingMessage("Checkout was canceled. Premium access was not changed.");
        setPage("home");
        return;
      }

      if (checkoutStatus !== "success" || !sessionId) {
        return;
      }

      setBillingStatus("loading");
      setBillingError("");

      try {
        const response = await fetch(`${API_BASE_URL}/api/billing/checkout-session/confirm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ sessionId }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message ?? "Unable to confirm your payment yet.");
        }

        const updatedUser = {
          ...(currentUser ?? {}),
          hasPremiumAccess: data.hasPremiumAccess,
          subscription: data.subscription,
        };
        setCurrentUser(updatedUser);
        localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(updatedUser));
        setBillingMessage(data.hasPremiumAccess ? "Premium access is active." : "Payment is still processing.");
        setPage(data.hasPremiumAccess && selectedBusiness ? "premium" : "home");
      } catch (error) {
        setBillingError(error.message);
        setPage("checkout");
      } finally {
        setBillingStatus("idle");
      }
    }

    handleCheckoutReturn();
  }, [authToken, currentUser, selectedBusiness]);

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
        const usePremiumInsights =
          currentUser?.hasPremiumAccess && currentUser?.googleBusinessProfileConnected;
        const response = usePremiumInsights
          ? await fetch(
              `${API_BASE_URL}/api/businesses/${encodeURIComponent(selectedBusiness.placeId)}/full-review-insights`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({
                  locationName: selectedGoogleLocationName || undefined,
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
          analysisResultId: data.analysisResultId ?? data.insights?.analysisResultId,
          businessProfileId: data.businessProfileId ?? data.insights?.businessProfileId,
          reviewsFetched: data.reviewsFetched,
          reviewsPulled: data.reviewsPulled ?? data.reviewsFetched ?? data.insights?.reviewsPulled,
          reviewsSaved: data.reviewsSaved ?? data.insights?.reviewsSaved,
          databaseSaveStatus: data.databaseSaveStatus,
          databaseSaveError: data.databaseSaveError,
          limitedData: data.limitedData ?? data.insights?.limitedReviewText,
          limitedDataMessage:
            data.limitedDataMessage ??
            data.insights?.limitedReviewMessage ??
            data.insights?.notEnoughReviewDataMessage,
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
  }, [
    selectedBusiness,
    selectedGoogleLocationName,
    authToken,
    currentUser?.hasPremiumAccess,
    currentUser?.googleBusinessProfileConnected,
  ]);

  useEffect(() => {
    if ((page === "free" || page === "premium") && !currentUser) {
      setPage("signin");
    }
  }, [currentUser, page]);

  const startSignup = (plan) => {
    setSelectedPlan(plan);
    setAuthError("");
    setBillingError("");

    if (plan === "premium" && currentUser) {
      setPage(currentUser.hasPremiumAccess ? "premium" : "checkout");
      return;
    }

    setPage("signup");
  };

  const startSignin = () => {
    setAuthError("");
    setPage("signin");
  };

  const saveSelectedBusinessToDatabase = async (selected, token = authToken) => {
    if (!selected || !token) return null;

    const response = await fetch(`${API_BASE_URL}/api/businesses/select`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        placeId: selected.placeId,
        name: selected.name,
        address: selected.address,
        rating: selected.rating,
        reviewCount: selected.reviewCount,
        category: selected.category,
      }),
    });

    if (!response.ok) {
      throw new Error("Selected business was saved locally but could not be saved to your account yet.");
    }

    return response.json();
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

  const handleAuthSuccess = async ({ user, token }) => {
    saveAuthSession({ user, token });
    setCurrentUser(user);
    setAuthToken(token);
    setAuthError("");

    if (selectedBusiness) {
      try {
        await saveSelectedBusinessToDatabase(selectedBusiness, token);
      } catch (error) {
        console.warn(error.message);
      }
      setPage("free");
      return;
    }

    setPage("home");
  };

  const submitSignup = async ({ name, email, password }) => {
    setAuthStatus("loading");
    setAuthError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to create your account.");
      }

      await handleAuthSuccess(data);
      setPage(selectedPlan === "premium" ? "checkout" : "success");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthStatus("idle");
    }
  };

  const submitSignin = async ({ email, password }) => {
    setAuthStatus("loading");
    setAuthError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to sign in.");
      }

      await handleAuthSuccess(data);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthStatus("idle");
    }
  };

  const refreshSubscription = async () => {
    if (!authToken || !currentUser) return null;

    const response = await fetch(`${API_BASE_URL}/api/billing/subscription`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message ?? "Unable to load subscription status.");
    }

    const updatedUser = {
      ...currentUser,
      hasPremiumAccess: data.hasPremiumAccess,
      subscription: data.subscription,
    };
    setCurrentUser(updatedUser);
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(updatedUser));

    return data;
  };

  const startStripeCheckout = async () => {
    if (!currentUser || !authToken) {
      setPage("signin");
      return;
    }

    setBillingStatus("loading");
    setBillingError("");
    setBillingMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/billing/checkout-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to start Stripe checkout.");
      }

      if (data.alreadySubscribed) {
        await refreshSubscription();
        setPage(selectedBusiness ? "premium" : "home");
        return;
      }

      if (!data.url) {
        throw new Error("Stripe checkout did not return a redirect URL.");
      }

      window.location.href = data.url;
    } catch (error) {
      setBillingError(error.message);
    } finally {
      setBillingStatus("idle");
    }
  };

  const openBillingPortal = async () => {
    if (!currentUser || !authToken) {
      setPage("signin");
      return;
    }

    setBillingStatus("loading");
    setBillingError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/billing/portal-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to open the billing portal.");
      }

      window.location.href = data.url;
    } catch (error) {
      setBillingError(error.message);
    } finally {
      setBillingStatus("idle");
    }
  };

  const startGoogleBusinessProfileConnection = async () => {
    if (!currentUser || !authToken) {
      setPage("signin");
      return;
    }

    setGoogleBusinessStatus("loading");
    setGoogleBusinessMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google/url`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to start Google Business Profile connection.");
      }

      window.location.href = data.url;
    } catch (error) {
      setGoogleBusinessStatus("error");
      setGoogleBusinessMessage(error.message);
    }
  };

  const loadGoogleBusinessLocations = async () => {
    if (!authToken) {
      setPage("signin");
      return;
    }

    setGoogleBusinessStatus("loading");
    setGoogleBusinessMessage("Loading Google Business Profile locations...");

    try {
      const response = await fetch(`${API_BASE_URL}/api/businesses/google-business-profile/locations`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to load Google Business Profile locations.");
      }

      setGoogleBusinessLocations(data.locations ?? []);
      const matchingLocation = (data.locations ?? []).find(
        (location) => location.placeId && location.placeId === selectedBusiness?.placeId,
      );
      setSelectedGoogleLocationName(matchingLocation?.locationName ?? data.locations?.[0]?.locationName ?? "");
      setGoogleBusinessStatus("connected");
      setGoogleBusinessMessage(
        data.locations?.length
          ? "Google Business Profile connected. Select the verified location to sync reviews."
          : "Google account connected, but no managed business locations were found.",
      );
    } catch (error) {
      setGoogleBusinessStatus("error");
      setGoogleBusinessMessage(error.message);
    }
  };

  const syncGoogleBusinessProfileReviews = async () => {
    if (!selectedBusiness?.placeId || !authToken) {
      return;
    }

    setGoogleBusinessStatus("syncing");
    setGoogleBusinessMessage("Pulling full Google Business Profile reviews...");
    setInsightError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/businesses/${encodeURIComponent(selectedBusiness.placeId)}/google-business-profile/sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            locationName: selectedGoogleLocationName || undefined,
            name: selectedBusiness.name,
            address: selectedBusiness.address ?? selectedBusiness.location,
            rating: selectedBusiness.rating,
            reviewCount: selectedBusiness.reviewCount,
            category: selectedBusiness.category,
          }),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to sync Google Business Profile reviews.");
      }

      setReviewInsights({
        ...data.insights,
        analysisSource: data.source ?? data.insights?.source,
        analysisResultId: data.analysisResultId ?? data.insights?.analysisResultId,
        businessProfileId: data.businessProfileId ?? data.insights?.businessProfileId,
        reviewsFetched: data.reviewsFetched,
        reviewsPulled: data.reviewsFetched,
        reviewsSaved: data.reviewsSaved,
        limitedData: false,
      });
      setInsightStatus("success");
      setGoogleBusinessStatus("synced");
      setGoogleBusinessMessage(`${data.reviewsFetched ?? 0} Google Business Profile reviews synced.`);
    } catch (error) {
      setGoogleBusinessStatus("error");
      setGoogleBusinessMessage(error.message);
      setInsightError(error.message);
    }
  };

  const chooseBusiness = async (business) => {
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

    if (!currentUser || !authToken) {
      setPage("signin");
      return;
    }

    try {
      await saveSelectedBusinessToDatabase(selected);
    } catch (error) {
      console.warn(error.message);
    }
    setPage("free");
  };

  const continueToDashboard = () => {
    if (!currentUser) {
      setPage("signin");
      return;
    }

    if (!selectedBusiness) {
      setPage("home");
      return;
    }

    if (selectedPlan === "premium") {
      setPage(currentUser.hasPremiumAccess ? "premium" : "checkout");
    } else {
      setPage("free");
    }
  };

  const signOut = async () => {
    if (authToken) {
      fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }

    setSelectedBusiness(null);
    setSelectedGooglePlaceId(null);
    setReviewInsights(null);
    setInsightStatus("idle");
    setInsightError("");
    setGoogleUserId(null);
    setGoogleBusinessStatus("idle");
    setGoogleBusinessMessage("");
    setGoogleBusinessLocations([]);
    setSelectedGoogleLocationName("");
    setCurrentUser(null);
    setAuthToken(null);
    clearAuthSession();
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
          startSignin={startSignin}
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
          googleUserId={currentUser?.googleBusinessProfileConnected ? currentUser.id : null}
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
          googleUserId={currentUser?.googleBusinessProfileConnected ? currentUser.id : null}
          selectedGooglePlaceId={selectedGooglePlaceId}
          signOut={signOut}
          currentUser={currentUser}
          authToken={authToken}
          startSignup={startSignup}
          openBillingPortal={openBillingPortal}
          billingStatus={billingStatus}
          billingError={billingError}
          googleBusinessStatus={googleBusinessStatus}
          googleBusinessMessage={googleBusinessMessage}
          googleBusinessLocations={googleBusinessLocations}
          selectedGoogleLocationName={selectedGoogleLocationName}
          setSelectedGoogleLocationName={setSelectedGoogleLocationName}
          startGoogleBusinessProfileConnection={startGoogleBusinessProfileConnection}
          loadGoogleBusinessLocations={loadGoogleBusinessLocations}
          syncGoogleBusinessProfileReviews={syncGoogleBusinessProfileReviews}
        />
      )}

      {page === "signup" && (
        <SignupPage
          selectedPlan={selectedPlan}
          setSelectedPlan={setSelectedPlan}
          setPage={setPage}
          submitSignup={submitSignup}
          authStatus={authStatus}
          authError={authError}
        />
      )}

      {page === "signin" && (
        <SigninPage
          submitSignin={submitSignin}
          startSignup={startSignup}
          setPage={setPage}
          authStatus={authStatus}
          authError={authError}
        />
      )}

      {page === "checkout" && (
        <CheckoutPage
          selectedPlan={selectedPlan}
          setPage={setPage}
          startStripeCheckout={startStripeCheckout}
          billingStatus={billingStatus}
          billingError={billingError}
          billingMessage={billingMessage}
          currentUser={currentUser}
        />
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

function HomePage({ searchBusinesses, searchStatus, searchError, startSignup, startSignin }) {
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
          <button className="navGhost" onClick={startSignin}>
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
                <TrendLineGraph
                  values={[12, 24, 41, 34]}
                  labels={["Jan", "Feb", "Mar", "Apr"]}
                  max={50}
                  suffix=""
                />
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
function SignupPage({ selectedPlan, setSelectedPlan, setPage, submitSignup, authStatus, authError }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    submitSignup({ name, email, password });
  };

  return (
    <section className="signupPage">
      <form className="signupCard" onSubmit={handleSubmit}>
        <p className="eyebrow">Account Setup</p>
        <h1>Create your Review Intel Care account</h1>
        <p className="signupText">
          Choose a plan, enter your account details, and continue to your dashboard.
        </p>

        <div className="signupForm">
          <input placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} required />
          <input placeholder="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
          <input placeholder="Business name" />
        </div>

        {authError && <p className="searchError">{authError}</p>}

        <div className="signupPlans">
          <button
            type="button"
            className={selectedPlan === "free" ? "selectedPlan" : ""}
            onClick={() => setSelectedPlan("free")}
          >
            <strong>Free</strong>
            <span>$0/month</span>
          </button>

          <button
            type="button"
            className={selectedPlan === "premium" ? "selectedPlan" : ""}
            onClick={() => setSelectedPlan("premium")}
          >
            <strong>Premium</strong>
            <span>$20/month</span>
          </button>
        </div>

        <button
          type="submit"
          className="signupPrimary"
          disabled={authStatus === "loading"}
        >
          {authStatus === "loading" ? "Creating Account..." : "Continue"}
        </button>

        <button className="signupSecondary" type="button" onClick={() => setPage("home")}>
          Back to Home
        </button>
      </form>
    </section>
  );
}

function SigninPage({ submitSignin, startSignup, setPage, authStatus, authError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    submitSignin({ email, password });
  };

  return (
    <section className="signupPage">
      <form className="signupCard" onSubmit={handleSubmit}>
        <p className="eyebrow">Welcome Back</p>
        <h1>Sign in to Review Intel Care</h1>
        <p className="signupText">
          Sign in to view your selected business, Free Snapshot, and saved review analysis.
        </p>

        <div className="signupForm">
          <input placeholder="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>

        {authError && <p className="searchError">{authError}</p>}

        <button className="signupPrimary" type="submit" disabled={authStatus === "loading"}>
          {authStatus === "loading" ? "Signing In..." : "Sign In"}
        </button>

        <button className="signupSecondary" type="button" onClick={() => startSignup("free")}>
          Create Account
        </button>

        <button className="signupSecondary" type="button" onClick={() => setPage("home")}>
          Back to Home
        </button>
      </form>
    </section>
  );
}

function CheckoutPage({ selectedPlan, setPage, startStripeCheckout, billingStatus, billingError, billingMessage, currentUser }) {
  return (
    <section className="signupPage">
      <div className="signupCard">
        <p className="eyebrow">Checkout</p>
        <h1>Start Premium</h1>
        <p className="signupText">
          Premium is billed securely through Stripe at $20/month. Your premium access is activated after payment succeeds.
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

        {currentUser?.hasPremiumAccess ? (
          <p className="signupText">Premium access is active for this account.</p>
        ) : (
          <p className="signupText">
            You will be redirected to Stripe Checkout to enter payment details.
          </p>
        )}

        {billingMessage && <p className="signupText">{billingMessage}</p>}
        {billingError && <p className="searchError">{billingError}</p>}

        <button
          className="signupPrimary"
          onClick={currentUser?.hasPremiumAccess ? () => setPage("premium") : startStripeCheckout}
          disabled={billingStatus === "loading"}
        >
          {currentUser?.hasPremiumAccess
            ? "Go to Premium Dashboard"
            : billingStatus === "loading"
              ? "Opening Stripe..."
              : "Continue to Stripe Checkout"}
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
  const pulseScore = insights?.sentimentScore ?? insights?.pulseScore ?? fallbackPulseScore;
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
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const backendLimitedMessage = insights?.limitedReviewText
    ? notEnoughMessage
    : "The Free Snapshot analyzes only a limited review sample. Upgrade to Premium to analyze all available reviews, uncover trends, and unlock deeper AI insights.";
  const limitedMessage =
    insights?.limitedData || insights?.limitedReviewText
      ? backendLimitedMessage
      : !googleUserId
        ? "The Free Snapshot shows limited review data. Upgrade to Premium to unlock complete review intelligence and AI-powered analysis."
        : "";
  const totalGoogleReviews = dashboardBusiness.reviewCount;
  const analyzedReviewTexts = insights?.reviewsAnalyzed ?? 0;
  const reviewsPulled = insights?.reviewsPulled ?? insights?.reviewsFetched ?? 0;
  const reviewsSaved = insights?.reviewsSaved ?? insights?.reviewsAvailable ?? 0;
  const reviewsMetricValue = googleUserId ? analyzedReviewTexts : reviewsPulled || analyzedReviewTexts;
  const reviewsMetricLabel = googleUserId ? "Reviews Analyzed" : "Public Review Texts Available";
  const reviewsMetricDetail = insights
    ? googleUserId
      ? `${analyzedReviewTexts} of ${totalGoogleReviews} reviews analyzed`
      : reviewsPulled || reviewsSaved
        ? `${totalGoogleReviews} total reviews found. ${reviewsPulled} pulled, ${reviewsSaved} saved for analysis.`
        : `${totalGoogleReviews} total reviews found. ${backendLimitedMessage}`
    : "";
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
          <p>{reviewsMetricLabel}</p>
          <h2><span className="metricIcon chart">📈</span>{reviewsMetricValue}</h2>
          {insights && (
            <small>
              {reviewsMetricDetail}
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

function PremiumDashboard({
  business,
  insights,
  insightStatus,
  insightError,
  googleUserId,
  signOut,
  currentUser,
  authToken,
  startSignup,
  openBillingPortal,
  billingStatus,
  billingError,
  googleBusinessStatus,
  googleBusinessMessage,
  googleBusinessLocations,
  selectedGoogleLocationName,
  setSelectedGoogleLocationName,
  startGoogleBusinessProfileConnection,
  loadGoogleBusinessLocations,
  syncGoogleBusinessProfileReviews,
}) {
  const [activeSection, setActiveSection] = useState("overview");

  if (!currentUser?.hasPremiumAccess) {
    return (
      <section className="dashboardPage">
        <div className="dashboardHeader">
          <div>
            <p className="eyebrow">Premium Locked</p>
            <h1>Upgrade to unlock Premium Intelligence</h1>
            <p className="muted">
              Premium features require an active $20/month subscription. Free Snapshot features are still available.
            </p>
            {billingError && <p className="searchError">{billingError}</p>}
          </div>

          <div className="freeHeaderActions">
            <button className="goldButton" onClick={() => startSignup("premium")} disabled={billingStatus === "loading"}>
              {billingStatus === "loading" ? "Opening Stripe..." : "Unlock Premium"}
            </button>
            <button className="freeSignOutButton" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </div>
      </section>
    );
  }

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
        <button className="signOutButton" onClick={openBillingPortal} disabled={billingStatus === "loading"}>
          Manage Billing
        </button>
      </aside>

      <main className="premiumContent">
        {activeSection === "overview" && (
          <OverviewView
            business={business}
            insights={insights}
            insightStatus={insightStatus}
            insightError={insightError}
            googleUserId={googleUserId}
            currentUser={currentUser}
            googleBusinessStatus={googleBusinessStatus}
            googleBusinessMessage={googleBusinessMessage}
            googleBusinessLocations={googleBusinessLocations}
            selectedGoogleLocationName={selectedGoogleLocationName}
            setSelectedGoogleLocationName={setSelectedGoogleLocationName}
            startGoogleBusinessProfileConnection={startGoogleBusinessProfileConnection}
            loadGoogleBusinessLocations={loadGoogleBusinessLocations}
            syncGoogleBusinessProfileReviews={syncGoogleBusinessProfileReviews}
          />
        )}
        {activeSection === "sentiment" && <SentimentView business={business} insights={insights} />}
        {activeSection === "reviews" && <ReviewsView business={business} insights={insights} />}
        {activeSection === "trends" && <TrendsView business={business} insights={insights} />}
        {activeSection === "sources" && <SourcesView business={business} insights={insights} />}
        {activeSection === "reports" && <ReportsView business={business} insights={insights} currentUser={currentUser} authToken={authToken} startSignup={startSignup} />}
      </main>
    </section>
  );
}

function OverviewView({
  business,
  insights,
  insightStatus,
  insightError,
  googleUserId,
  currentUser,
  googleBusinessStatus,
  googleBusinessMessage,
  googleBusinessLocations,
  selectedGoogleLocationName,
  setSelectedGoogleLocationName,
  startGoogleBusinessProfileConnection,
  loadGoogleBusinessLocations,
  syncGoogleBusinessProfileReviews,
}) {
  const reviewCount = insights?.reviewCount ?? business.reviewCount ?? business.reviews ?? 0;
  const pulseScore = insights?.sentimentScore ?? insights?.pulseScore ?? getPulseScoreFromRating(insights?.rating ?? business.rating);
  const pulseLabel = insights?.pulseLabel ?? getPulseLabel(pulseScore);
  const sentimentBreakdown = insights?.sentimentBreakdown ?? { positive: 0, neutral: 0, negative: 0 };
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const complimentThemes = insights?.topCompliments ?? [];
  const complaintThemes = insights?.topComplaints ?? [];
  const trendSeries = getMonthlyTrendSeries(insights);
  const sourceBreakdown = insights?.sourceBreakdown ?? {};
  const googleReviewCount =
    sourceBreakdown.google_business_profile ?? sourceBreakdown.google_places ?? reviewCount;
  const strongestComplaint = complaintThemes[0];
  const complaintPercent =
    strongestComplaint && insights?.reviewsAnalyzed
      ? `${Math.round((strongestComplaint.count / insights.reviewsAnalyzed) * 100)}%`
      : "0%";
  const isGoogleConnected = Boolean(currentUser?.googleBusinessProfileConnected || googleUserId);
  const matchingLocation = googleBusinessLocations.find(
    (location) => location.locationName === selectedGoogleLocationName,
  );
  const syncDisabled =
    googleBusinessStatus === "loading" ||
    googleBusinessStatus === "syncing" ||
    (googleBusinessLocations.length > 0 && !selectedGoogleLocationName) ||
    matchingLocation?.verificationState === "NOT_VERIFIED";

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Premium Intelligence Dashboard</p>
          <h1>{business.name}</h1>
          <p className="muted">
            {business.location} <span aria-hidden="true">·</span> {reviewCount} reviews <span aria-hidden="true">·</span> {insights?.businessType ?? business.category}
          </p>
          <div className="gbpConnectPanel">
            <div>
              <span className={`gbpStatusDot ${isGoogleConnected ? "connected" : ""}`}></span>
              <strong>{isGoogleConnected ? "Google Business Profile Connected" : "Google Business Profile Not Connected"}</strong>
              <p>
                {isGoogleConnected
                  ? "Pull paginated reviews from your verified Google Business Profile location for Premium analysis."
                  : "Connect Google Business Profile to unlock more than the limited public review sample."}
              </p>
              {googleBusinessMessage && <p className="gbpStatusMessage">{googleBusinessMessage}</p>}
            </div>

            <div className="gbpActions">
              {!isGoogleConnected ? (
                <button
                  className="goldButton"
                  onClick={startGoogleBusinessProfileConnection}
                  disabled={googleBusinessStatus === "loading"}
                >
                  {googleBusinessStatus === "loading" ? "Connecting..." : "Connect Google Business Profile"}
                </button>
              ) : (
                <>
                  <button
                    className="outlineButton"
                    onClick={loadGoogleBusinessLocations}
                    disabled={googleBusinessStatus === "loading" || googleBusinessStatus === "syncing"}
                  >
                    {googleBusinessStatus === "loading" ? "Loading..." : "Load Managed Locations"}
                  </button>

                  {googleBusinessLocations.length > 0 && (
                    <select
                      value={selectedGoogleLocationName}
                      onChange={(event) => setSelectedGoogleLocationName(event.target.value)}
                    >
                      {googleBusinessLocations.map((location) => (
                        <option key={location.locationName} value={location.locationName}>
                          {location.title ?? "Unnamed Location"} - {location.verificationState}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    className="goldButton"
                    onClick={syncGoogleBusinessProfileReviews}
                    disabled={syncDisabled}
                  >
                    {googleBusinessStatus === "syncing" ? "Pulling Reviews..." : "Sync Google Reviews"}
                  </button>
                </>
              )}
            </div>
          </div>
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
            <SourceCard source="Google Reviews" count={googleReviewCount || "Coming Soon"} />
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
          {trendSeries ? (
            <TrendLineGraph
              values={trendSeries.values}
              labels={trendSeries.labels}
              max={Math.max(5, ...trendSeries.values)}
              suffix=""
            />
          ) : (
            <p className="emptyInsightMessage">{notEnoughMessage}</p>
          )}
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
  const pulseScore = insights?.sentimentScore ?? insights?.pulseScore ?? getPulseScoreFromRating(insights?.rating ?? business.rating);

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
  const trendSeries = getMonthlyTrendSeries(insights);

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
          {trendSeries ? (
            <TrendLineGraph
              values={trendSeries.values}
              labels={trendSeries.labels}
              max={Math.max(10, ...trendSeries.values)}
              suffix=""
            />
          ) : (
            <p className="emptyInsightMessage">{notEnoughMessage}</p>
          )}
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

function ReportsView({ business, insights, currentUser, authToken, startSignup }) {
  const [selectedReport, setSelectedReport] = useState("Weekly");
  const [selectedNotification, setSelectedNotification] = useState("Weekly");
  const [selectedReportDetail, setSelectedReportDetail] = useState(null);
  const [emailPreference, setEmailPreference] = useState(null);
  const [isEditingEmailPreference, setIsEditingEmailPreference] = useState(false);
  const [notificationEmail, setNotificationEmail] = useState(currentUser?.email ?? "");
  const [reportStatus, setReportStatus] = useState("idle");
  const [reportError, setReportError] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailExportAddress, setEmailExportAddress] = useState(currentUser?.email ?? "");
  const [emailExportError, setEmailExportError] = useState("");
  const notEnoughMessage = insights?.notEnoughReviewDataMessage ?? "Not enough review data available yet.";
  const businessProfileId = insights?.businessProfileId;
  const canUseReports = currentUser?.hasPremiumAccess;

  const reportOptions = [
    {
      title: "Daily",
      description: "A short pulse report covering yesterday's reviews, urgent complaints, and rating changes.",
    },
    {
      title: "Weekly",
      description: "A manager summary with source performance, sentiment shifts, and top action items.",
    },
    {
      title: "Monthly",
      description: "An executive rollup with trends, complaint categories, source comparison, and recommendations.",
    },
  ];
  const selectedReportOption = reportOptions.find((option) => option.title === selectedReport);
  const selectedCadence = selectedReport.toUpperCase();

  const loadEmailPreference = async () => {
    if (!authToken || !businessProfileId || !canUseReports) {
      return;
    }

    try {
      const params = new URLSearchParams({ businessProfileId });
      const response = await fetch(`${API_BASE_URL}/api/reports/preferences/email?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to load email notification setup.");
      }

      setEmailPreference(data.preference ?? null);
      if (data.preference) {
        setSelectedNotification(toTitleCase(data.preference.frequency));
        setNotificationEmail(data.preference.destinationEmail);
      }
    } catch (error) {
      setReportError(error.message);
    }
  };

  useEffect(() => {
    loadEmailPreference();
  }, [authToken, businessProfileId, canUseReports]);

  const generateSelectedReport = async () => {
    if (!canUseReports) {
      return;
    }

    if (!businessProfileId) {
      setReportError("Confirm a business and load review insights before generating reports.");
      return;
    }

    setReportStatus("loading");
    setReportError("");
    setReportMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          businessProfileId,
          cadence: selectedCadence,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to generate report.");
      }

      setSelectedReportDetail(data.report);
      setReportMessage(`${selectedReport} report generated.`);
      setReportStatus("success");
    } catch (error) {
      setReportError(error.message);
      setReportStatus("error");
    }
  };

  const downloadCurrentReportPdf = async () => {
    if (!selectedReportDetail?.id) {
      setReportError("Generate a report before downloading or emailing it.");
      return;
    }

    setReportStatus("loading");
    setReportError("");
    setReportMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports/${selectedReportDetail.id}/export/pdf`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error?.message ?? "Unable to export PDF.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = reportPdfFilename(selectedReportDetail);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setReportMessage("PDF export downloaded.");
      setReportStatus("success");
    } catch (error) {
      setReportError(error.message);
      setReportStatus("error");
    }
  };

  const openEmailReportModal = () => {
    if (!selectedReportDetail?.id) {
      setReportError("Generate a report before emailing it.");
      return;
    }
    setEmailExportAddress(currentUser?.email ?? "");
    setEmailExportError("");
    setEmailModalOpen(true);
  };

  const emailCurrentReport = async () => {
    if (!selectedReportDetail?.id) {
      setEmailExportError("Generate a report before emailing it.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailExportAddress)) {
      setEmailExportError("Enter a valid email address.");
      return;
    }

    setReportStatus("loading");
    setReportError("");
    setReportMessage("");
    setEmailExportError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports/${selectedReportDetail.id}/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ destinationEmail: emailExportAddress }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error("Email export could not be set. Please try again.");
      }

      setSelectedReportDetail(data.report ?? selectedReportDetail);
      setReportMessage(data.message ?? "Email delivery is not configured yet. Your report export request was saved.");
      setEmailModalOpen(false);
      setReportStatus("success");
    } catch (error) {
      setEmailExportError(error.message);
      setReportStatus("error");
    }
  };

  const saveEmailPreference = async () => {
    if (!businessProfileId) {
      setReportError("Confirm a business before saving email notifications.");
      return;
    }

    setReportStatus("loading");
    setReportError("");
    setReportMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports/preferences/email`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          businessProfileId,
          frequency: selectedNotification.toUpperCase(),
          destinationEmail: notificationEmail,
          enabled: true,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to save email notification setup.");
      }

      setEmailPreference(data.preference);
      setIsEditingEmailPreference(false);
      setReportMessage("Email notification setup saved.");
      setReportStatus("success");
    } catch (error) {
      setReportError(error.message);
      setReportStatus("error");
    }
  };

  const disableEmailPreference = async () => {
    setReportStatus("loading");
    setReportError("");
    setReportMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports/preferences/email`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ businessProfileId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Unable to disable email notifications.");
      }

      setEmailPreference(data.preference);
      setIsEditingEmailPreference(false);
      setReportMessage("Email notifications disabled.");
      setReportStatus("success");
    } catch (error) {
      setReportError(error.message);
      setReportStatus("error");
    }
  };

  if (!canUseReports) {
    return (
      <>
        <div className="premiumTop">
          <div>
            <p className="eyebrow">Reports</p>
            <h1>Executive Reports</h1>
            <p className="muted">
              Daily, weekly, and monthly reports are included with Premium.
            </p>
          </div>
        </div>

        <DashboardWidget title="Reports are a Premium feature">
          <p className="emptyInsightMessage">
            Upgrade to Premium to generate and save review intelligence reports for {business.name}.
          </p>
          <button className="goldButton" onClick={() => startSignup("premium")}>
            Unlock Premium Reports
          </button>
        </DashboardWidget>
      </>
    );
  }

  return (
    <>
      <div className="premiumTop">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Executive Reports</h1>
          <p className="muted">
            Generate, export, and schedule review intelligence reports for {business.name}.
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
                description={option.description}
                selected={selectedReport === option.title}
                onSelect={() => setSelectedReport(option.title)}
              />
            ))}
          </div>
          <div className="selectedExport">
            Selected report: <strong>{selectedReportOption?.title} report</strong>
          </div>
          {reportError && <p className="searchError">{reportError}</p>}
          <button className="enrollButton" type="button" onClick={generateSelectedReport} disabled={reportStatus === "loading"}>
            {reportStatus === "loading" ? "Generating Report..." : `Generate ${selectedReport} Report`}
          </button>
        </DashboardWidget>

        <DashboardWidget title="Report Detail">
          {selectedReportDetail ? (
            <ReportDetail report={selectedReportDetail} />
          ) : (
            <p className="emptyInsightMessage">Generate a {selectedReport.toLowerCase()} report to view its details here.</p>
          )}
        </DashboardWidget>

        <DashboardWidget title="Download / Export Options">
          <div className="selectedExport">
            Selected export: <strong>{selectedReport} report</strong>
          </div>
          <div className="exportActions">
            <button type="button" onClick={downloadCurrentReportPdf}>Download PDF</button>
            <button type="button" onClick={openEmailReportModal}>Email Report</button>
          </div>
          {reportMessage && <p className="exportNote">{reportMessage}</p>}
          {reportError && <p className="searchError">{reportError}</p>}
        </DashboardWidget>

        <DashboardWidget title="Email Notification Setup">
          <div className="notificationSetup">
            {emailPreference?.enabled && !isEditingEmailPreference ? (
              <div className="activeEmailSetup">
                <div className="selectedExport">
                  Active notifications: <strong>{toTitleCase(emailPreference.frequency)}</strong>
                  <span>{emailPreference.destinationEmail}</span>
                </div>
                <div className="exportActions">
                  <button type="button" onClick={() => setIsEditingEmailPreference(true)}>Update Setup</button>
                  <button type="button" onClick={disableEmailPreference}>Disable Notifications</button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="reportEmail">Send review performance reports to</label>
                  <input
                    id="reportEmail"
                    placeholder="owner@example.com"
                    value={notificationEmail}
                    onChange={(event) => setNotificationEmail(event.target.value)}
                  />
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
                      </button>
                    ))}
                  </div>
                </div>

                <div className="selectedExport">
                  Email notifications: <strong>{selectedNotification}</strong>
                </div>

                <button className="enrollButton" type="button" onClick={saveEmailPreference}>
                  Save {selectedNotification} Email Preference
                </button>
              </>
            )}
          </div>
        </DashboardWidget>
      </div>

      {emailModalOpen && (
        <div className="reportModalBackdrop" onClick={() => setEmailModalOpen(false)}>
          <div className="reportEmailModal" onClick={(event) => event.stopPropagation()}>
            <div className="reportModalHeader">
              <h2>Email Report</h2>
              <button type="button" onClick={() => setEmailModalOpen(false)}>X</button>
            </div>
            <label htmlFor="emailExportAddress">Send report to</label>
            <input
              id="emailExportAddress"
              value={emailExportAddress}
              onChange={(event) => setEmailExportAddress(event.target.value)}
              placeholder="owner@example.com"
              type="email"
            />
            {emailExportError && <p className="searchError">{emailExportError}</p>}
            <div className="reportModalActions">
              <button className="signupSecondary" type="button" onClick={() => setEmailModalOpen(false)}>
                Cancel
              </button>
              <button className="signupPrimary" type="button" onClick={emailCurrentReport} disabled={reportStatus === "loading"}>
                {reportStatus === "loading" ? "Setting Export..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatDate(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toTitleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function reportPdfFilename(report) {
  const businessName = report?.businessName ?? report?.rawPayload?.business?.name ?? "Review Intel Care";
  const safeBusinessName = businessName.replace(/[\\/:*?"<>|]/g, "").trim() || "Review Intel Care";
  return `${safeBusinessName}-${String(report?.cadence ?? "report").toLowerCase()}-report.pdf`;
}

function ReportDetail({ report }) {
  const content = report.rawPayload ?? {};
  const sections = content.sections ?? {};
  const overview = sections.overview ?? {};
  const positiveThemes = sections.positiveThemes ?? [];
  const negativeThemes = sections.negativeThemes ?? [];
  const actionItems = sections.actionItems ?? [];
  const sentiment = sections.sentiment ?? { positive: 0, neutral: 0, negative: 0 };

  const reportEmpty = (icon, message) => (
    <div className="reportEmptyState">
      <span>{icon}</span>
      <p>{message}</p>
    </div>
  );

  return (
    <div className="reportDetail">
      <div className="reportDetailHeader">
        <div>
          <span className="reportIconChip">▣</span>
          <strong>{report.title}</strong>
        </div>
        <span>{formatDate(report.dateRangeStart)} to {formatDate(report.dateRangeEnd)}</span>
      </div>

      <div className="reportMetricGrid">
        <div className="reportMetricCard">
          <i>★</i>
          <span>Overall Rating</span>
          <strong>{overview.rating ?? "N/A"}</strong>
          <small>Average public rating</small>
        </div>
        <div className="reportMetricCard">
          <i>●</i>
          <span>Customer Score</span>
          <strong>{overview.customerScore ?? "N/A"}</strong>
          <small>Review intelligence score</small>
        </div>
        <div className="reportMetricCard">
          <i>↗</i>
          <span>Reviews Analyzed</span>
          <strong>{overview.reviewsAnalyzed ?? 0}</strong>
          <small>Reviews used in this report</small>
        </div>
        <div className="reportMetricCard">
          <i>◐</i>
          <span>Sentiment</span>
          <strong>{sentiment.positive ?? 0} / {sentiment.neutral ?? 0} / {sentiment.negative ?? 0}</strong>
          <small>Positive / Neutral / Negative</small>
        </div>
      </div>

      <div className="reportDetailGrid">
        <div className="reportSectionBlock">
          <h3><span>◆</span>Summary</h3>
          {overview.summary || report.previewBody ? (
            <p>{overview.summary ?? report.previewBody}</p>
          ) : (
            reportEmpty("◆", "Not enough review data available yet.")
          )}
        </div>

        <div className="reportSectionBlock">
          <h3><span>●</span>Positive Themes</h3>
          {positiveThemes.length ? (
            positiveThemes.map((theme) => <MentionRow key={theme.label} label={theme.label} value={theme.value ?? ""} />)
          ) : (
            reportEmpty("●", "No repeated positive themes yet.")
          )}
        </div>

        <div className="reportSectionBlock">
          <h3><span>●</span>Negative Themes</h3>
          {negativeThemes.length ? (
            negativeThemes.map((theme) => <MentionRow key={theme.label} label={theme.label} value={theme.value ?? ""} />)
          ) : (
            reportEmpty("●", "No repeated negative themes yet.")
          )}
        </div>

        <div className="reportSectionBlock">
          <h3><span>✓</span>Suggested Action Items</h3>
          {actionItems.length ? (
            actionItems.map((item, index) => <MentionRow key={`${item}-${index}`} label={item} value="" />)
          ) : (
            reportEmpty("✓", "No action items available yet.")
          )}
        </div>

        <div className="reportSectionBlock">
          <h3><span>↗</span>Trend Summary</h3>
          {sections.trendSummary ? (
            <p>{sections.trendSummary}</p>
          ) : (
            reportEmpty("↗", "Not enough historical data available for trend analysis yet.")
          )}
        </div>

        <div className="reportSectionBlock">
          <h3><span>✉</span>Email Delivery</h3>
          <p>{report.emailStatus ?? "Not configured"}. Email sending will be added later.</p>
        </div>
      </div>
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
  const singlePointX = xStart + (xEnd - xStart) / 2;
  const xStep = values.length > 1 ? (xEnd - xStart) / (values.length - 1) : 0;

  const points = values
    .map((value, index) => {
      const x = values.length > 1 ? xStart + xStep * index : singlePointX;
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
          const x = values.length > 1 ? xStart + xStep * index : singlePointX;
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

function ReportOption({ title, description, selected, onSelect }) {
  return (
    <button
      className={selected ? "reportOption selected" : "reportOption"}
      onClick={onSelect}
      type="button"
    >
      <div>
        <strong>{title}</strong>
        <span>{selected ? "Selected" : "Choose"}</span>
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
