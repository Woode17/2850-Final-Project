import { SearchForm } from "../components/SearchForm";

const DESTINATIONS = [
  { code: "BCN", city: "Barcelona", flag: "🇪🇸", price: 89  },
  { code: "AMS", city: "Amsterdam", flag: "🇳🇱", price: 65  },
  { code: "DXB", city: "Dubai",     flag: "🇦🇪", price: 299 },
  { code: "CDG", city: "Paris",     flag: "🇫🇷", price: 74  },
];

function todayLocal() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function HomePage({ onSearch, confirmedBooking, onDismissConfirmation }) {
  function handleDestinationClick(code) {
    onSearch({
      tripType:      "one-way",
      from:          "LBA",
      to:            code,
      departureDate: todayLocal(),
      travelClass:   "economy",
      adults:        1,
      children:      0,
      infants:       0,
    });
  }

  return (
    <div className="page home-page">
      <div className="hero">
        <h1 className="hero-title">Where will you fly next?</h1>
        <p className="hero-subtitle">Search hundreds of routes. Book in minutes.</p>
        <SearchForm onSearch={onSearch} />
      </div>

      <div className="home-destinations">
        <div className="home-section-header">
          <h2 className="home-section-title">Popular destinations</h2>
        </div>

        <div className="dest-grid">
          {DESTINATIONS.map((d) => (
            <div
              key={d.code}
              className="dest-card"
              onClick={() => handleDestinationClick(d.code)}
              title={`Search flights to ${d.city} today`}
              style={{ cursor: "pointer" }}
            >
              <span className="dest-flag">{d.flag}</span>
              <div className="dest-info">
                <span className="dest-city">{d.city}</span>
                <span className="dest-code">{d.code}</span>
              </div>
              <span className="dest-price">from £{d.price}</span>
            </div>
          ))}
        </div>
      </div>

      {confirmedBooking && (
        <div className="confirmation-banner" style={{ maxWidth: 900, margin: "2rem auto 0", padding: "0 1.5rem" }}>
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