import { useState, useEffect, useMemo } from "react";
import { SearchForm } from "../components/SearchForm";
import { adminGetReports, getFlights } from "../services/api";

const AIRPORTS = {
  LBA: { city: "Leeds", flag: "GB" },
  LHR: { city: "London", flag: "GB" },
  LGW: { city: "London", flag: "GB" },
  MAN: { city: "Manchester", flag: "GB" },
  EDI: { city: "Edinburgh", flag: "GB" },
  BHX: { city: "Birmingham", flag: "GB" },
  BRS: { city: "Bristol", flag: "GB" },
  NCL: { city: "Newcastle", flag: "GB" },
  AMS: { city: "Amsterdam", flag: "NL" },
  CDG: { city: "Paris", flag: "FR" },
  BCN: { city: "Barcelona", flag: "ES" },
  MAD: { city: "Madrid", flag: "ES" },
  FCO: { city: "Rome", flag: "IT" },
  MXP: { city: "Milan", flag: "IT" },
  FRA: { city: "Frankfurt", flag: "DE" },
  MUC: { city: "Munich", flag: "DE" },
  DXB: { city: "Dubai", flag: "AE" },
  JFK: { city: "New York", flag: "US" },
  LAX: { city: "Los Angeles", flag: "US" },
  DUB: { city: "Dublin", flag: "IE" },
  CPH: { city: "Copenhagen", flag: "DK" },
  LIS: { city: "Lisbon", flag: "PT" },
  ATH: { city: "Athens", flag: "GR" },
};

const DEFAULT_CODES = ["AMS", "BCN", "CDG", "DUB", "MAD", "FCO"];

function destCode(routeStr) {
  const parts = routeStr.split(/→|->/).map((value) => value.trim());
  return parts[1] || null;
}

function buildSearchPayload(to, travelClass = "economy") {
  return {
    tripType: "one-way",
    from: "LBA",
    to,
    departureDate: "",
    travelClass,
    adults: 1,
    children: 0,
    infants: 0,
  };
}

function buildInspirationBlurb(city, index) {
  const blurbs = [
    `A strong short-haul option if you want an easy getaway to ${city}.`,
    `${city} is a good pick when you want a quick break without overthinking the route.`,
    `Browse fares to ${city} if you want a popular route with proven demand.`,
  ];
  return blurbs[index] || `Start with ${city} if you want an easy place to begin searching.`;
}

async function getDestinationCard(code, bookingCount = null) {
  if (!code || !AIRPORTS[code]) return null;

  try {
    const flights = await getFlights({ from: "LBA", to: code });
    if (!flights?.length) return null;

    const prices = flights.map((flight) => flight.price).filter((price) => typeof price === "number");
    return {
      code,
      city: AIRPORTS[code].city,
      flag: AIRPORTS[code].flag,
      price: prices.length ? Math.min(...prices) : null,
      bookingCount,
    };
  } catch {
    return null;
  }
}

export function HomePage({ onSearch, confirmedBooking, onDismissConfirmation }) {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadPopular() {
      setLoading(true);

      try {
        const reports = await adminGetReports();
        const seenDestinations = new Set();
        const popularCodes = (reports.popularRoutes || [])
          .map(({ route, count }) => ({ code: destCode(route), count }))
          .filter(({ code }) => {
            if (!code || seenDestinations.has(code)) return false;
            seenDestinations.add(code);
            return Boolean(AIRPORTS[code]);
          })
          .slice(0, 6);

        let cards = (await Promise.all(
          popularCodes.map(({ code, count }) => getDestinationCard(code, count))
        )).filter(Boolean);

        if (!cards.length) {
          cards = (await Promise.all(DEFAULT_CODES.map((code) => getDestinationCard(code)))).filter(Boolean);
        }

        if (!cancelled) {
          setDestinations(cards.slice(0, 4));
          setLoading(false);
        }
      } catch {
        const fallbackCards = (await Promise.all(DEFAULT_CODES.map((code) => getDestinationCard(code)))).filter(Boolean);
        if (!cancelled) {
          setDestinations(fallbackCards.slice(0, 4));
          setLoading(false);
        }
      }
    }

    loadPopular();
    return () => { cancelled = true; };
  }, []);

  const bestValueDestination = useMemo(() => {
    return [...destinations]
      .filter((destination) => typeof destination.price === "number")
      .sort((a, b) => a.price - b.price)[0] || null;
  }, [destinations]);

  const discoveryCodes = useMemo(() => {
    return destinations.slice(0, 4).map((destination) => destination.code);
  }, [destinations]);

  const inspirationCards = useMemo(() => {
    return destinations.slice(0, 3).map((destination, index) => ({
      title: index === 0 ? "Popular right now" : index === 1 ? "Good for a city break" : "Worth exploring",
      route: `LBA to ${destination.city}`,
      blurb: buildInspirationBlurb(destination.city, index),
      to: destination.code,
    }));
  }, [destinations]);

  return (
    <div className="page home-page">
      <div className="hero">
        <h1 className="hero-title">Where will you fly next?</h1>
        <p className="hero-subtitle">Search hundreds of routes. Book in minutes.</p>
        <SearchForm onSearch={onSearch} />
      </div>

      <div className="home-destinations">
        <div className="home-section-header">
          <div>
            <h2 className="home-section-title">Popular destinations</h2>
            <p className="home-section-copy">Browse the places customers are booking most right now.</p>
          </div>
          {!loading && destinations.length > 0 && <span className="home-section-badge">Based on recent bookings</span>}
        </div>

        <div className="dest-grid">
          {destinations.map((destination, index) => (
            <div
              key={destination.code}
              className={`dest-card ${loading ? "dest-card--loading" : ""}`}
              onClick={() => onSearch(buildSearchPayload(destination.code))}
              title={`Search flights to ${destination.city}`}
            >
              <span className="dest-rank">#{index + 1}</span>
              <span className="dest-flag">{destination.flag}</span>
              <div className="dest-info">
                <span className="dest-city">{destination.city}</span>
                <span className="dest-code">{destination.code}</span>
              </div>
              <span className="dest-price">
                {destination.price ? `from £${destination.price}` : "View flights"}
              </span>
              {destination.bookingCount ? (
                <span className="dest-meta">{destination.bookingCount} recent bookings</span>
              ) : (
                <span className="dest-meta">Available route</span>
              )}
            </div>
          ))}
        </div>

        {!loading && destinations.length === 0 && (
          <p className="muted-text">No live destination recommendations are available right now.</p>
        )}
      </div>

      <div className="home-discovery-grid">
        <div className="discovery-panel discovery-panel--value">
          <span className="booking-card-eyebrow">Best value this week</span>
          <h3>{bestValueDestination ? `${bestValueDestination.city} from £${bestValueDestination.price}` : "Affordable short-haul favourites"}</h3>
          <p>
            {bestValueDestination
              ? `Our lowest currently surfaced fare is for ${bestValueDestination.city}, making it a strong pick for a low-cost getaway.`
              : "Browse live destinations to spot the best-value route for your next trip."}
          </p>
          <button
            className="quick-action-btn"
            onClick={() => bestValueDestination && onSearch(buildSearchPayload(bestValueDestination.code))}
            disabled={!bestValueDestination}
          >
            Explore best value
          </button>
        </div>

        <div className="discovery-panel">
          <span className="booking-card-eyebrow">Flexible browsing</span>
          <h3>Not sure where to go yet?</h3>
          <p>Use the destination ideas below to jump straight into a search without filling every field first.</p>
          <div className="discovery-chip-row">
            {discoveryCodes.map((code) => (
              <button key={code} className="discovery-chip" onClick={() => onSearch(buildSearchPayload(code))}>
                {code}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="home-inspiration">
        <div className="home-section-header">
          <div>
            <h2 className="home-section-title">Travel ideas</h2>
            <p className="home-section-copy">A few curated starting points when you want inspiration instead of a blank search.</p>
          </div>
        </div>
        <div className="inspiration-grid">
          {inspirationCards.map((card) => (
            <div key={card.title + card.to} className="inspiration-card">
              <span className="booking-card-eyebrow">{card.route}</span>
              <h3>{card.title}</h3>
              <p>{card.blurb}</p>
              <button className="quick-action-btn" onClick={() => onSearch(buildSearchPayload(card.to))}>
                Search this route
              </button>
            </div>
          ))}
        </div>
      </div>

      {confirmedBooking && (
        <div className="confirmation-banner" style={{ maxWidth: 900, margin: "2rem auto", marginLeft: "1.5rem", marginRight: "1.5rem" }}>
          <span className="confirm-icon">✓</span>
          <div>
            <strong>Booking confirmed!</strong>
            <p>Reference: <code>{confirmedBooking.bookingReference || confirmedBooking.id}</code></p>
            <p>Confirmation email sent to {confirmedBooking.passenger?.email}.</p>
          </div>
          <button className="dismiss-btn" onClick={onDismissConfirmation}>×</button>
        </div>
      )}
    </div>
  );
}
