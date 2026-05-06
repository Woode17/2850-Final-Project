import { useState } from "react";
import { AuthProvider } from "./context/AuthContext";
import { Navbar } from "./components/Navbar";

import { HomePage } from "./pages/HomePage";
import { FlightResultsPage } from "./pages/FlightResultsPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ManageBookingPage } from "./pages/ManageBookingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AccountPage } from "./pages/AccountPage";
import { RewardsPage } from "./pages/RewardsPage";
import { ComplaintPage } from "./pages/ComplaintPage";
import { CheckInPage } from "./pages/CheckInPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { BookingFlowPage } from "./pages/BookingFlowPage";

import "./Styles.css";

function AppInner() {
  const [page, setPage] = useState("home");
  const [searchParams, setSearchParams] = useState(null);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [manageBookingPreset, setManageBookingPreset] = useState(null);
  const [checkInPreset, setCheckInPreset] = useState(null);

  function handleSearch(params) {
    setSearchParams(params);
    setPage("results");
  }

  function handleSelectFlight(flightWithFare) {
    setSelectedFlight({ ...flightWithFare, searchParams });
    setPage("booking-flow");
  }

  function handleBookingComplete(booking) {
    setConfirmedBooking(booking);
    setSelectedFlight(null);
    setSearchParams(null);
    setPage("home");
  }

  function handleManageBookingFromList(booking) {
    setManageBookingPreset({
      ref: booking.bookingReference || String(booking.id),
      lastName: booking.passenger?.lastName || "",
    });
    setPage("manage");
  }

  function handleCheckInFromList(booking) {
    setCheckInPreset({
      ref: booking.bookingReference || String(booking.id),
      lastName: booking.passenger?.lastName || "",
    });
    setPage("checkin");
  }

  function handleRebookRoute(booking) {
    setSearchParams({
      tripType: "one-way",
      from: booking.flight?.from || booking.from || "LBA",
      to: booking.flight?.to || booking.to || "",
      departureDate: "",
      travelClass: (booking.travelClass || "economy").toLowerCase(),
      adults: 1,
      children: 0,
      infants: 0,
    });
    setPage("results");
  }

  function renderPage() {
    switch (page) {
      case "home":
        return (
          <HomePage
            onSearch={handleSearch}
            confirmedBooking={confirmedBooking}
            onDismissConfirmation={() => setConfirmedBooking(null)}
          />
        );
      case "results":
        return (
          <FlightResultsPage
            searchParams={searchParams}
            onNavigate={setPage}
            onSelectFlight={handleSelectFlight}
          />
        );
      case "booking-flow":
        return (
          <BookingFlowPage
            flight={selectedFlight}
            onNavigate={setPage}
            onComplete={handleBookingComplete}
          />
        );
      case "bookings":
        return (
          <BookingsPage
            onNavigate={setPage}
            onManageBooking={handleManageBookingFromList}
            onRebookRoute={handleRebookRoute}
            onViewCheckIn={handleCheckInFromList}
          />
        );
      case "manage":
        return (
          <ManageBookingPage
            initialLookup={manageBookingPreset}
            onLookupConsumed={() => setManageBookingPreset(null)}
          />
        );
      case "checkin":
        return (
          <CheckInPage
            initialLookup={checkInPreset}
            onLookupConsumed={() => setCheckInPreset(null)}
          />
        );
      case "login":
        return <LoginPage onNavigate={setPage} />;
      case "register":
        return <RegisterPage onNavigate={setPage} />;
      case "account":
        return <AccountPage onNavigate={setPage} />;
      case "rewards":
        return <RewardsPage onNavigate={setPage} />;
      case "complaint":
        return <ComplaintPage />;
      case "admin-login":
        return <AdminLoginPage onNavigate={setPage} />;
      case "admin-dashboard":
        return <AdminDashboardPage onNavigate={setPage} />;
      default:
        return <HomePage onSearch={handleSearch} />;
    }
  }

  const isAdminPage = page === "admin-login" || page === "admin-dashboard";

  return (
    <div className="app">
      {!isAdminPage && <Navbar activePage={page} onNavigate={setPage} />}
      <main className="main-content">{renderPage()}</main>
      {!isAdminPage && (
        <footer className="footer">
          <div className="footer-inner">
            <div className="footer-brand-block">
              <span className="footer-eyebrow">About LeedsAir</span>
              <h3>Built for a smoother booking journey.</h3>
              <p>
                LeedsAir brings search, booking, check-in, loyalty rewards, and booking management
                together in one streamlined travel experience.
              </p>
            </div>

            <div className="footer-column">
              <h4>Passenger Support</h4>
              <div className="footer-links">
                <button className="footer-link" onClick={() => setPage("manage")}>Manage Booking</button>
                <button className="footer-link" onClick={() => setPage("checkin")}>Online Check-In</button>
                <button className="footer-link" onClick={() => setPage("complaint")}>Submit Complaint</button>
              </div>
            </div>

            <div className="footer-column">
              <h4>Platform</h4>
              <div className="footer-links">
                <button className="footer-link" onClick={() => setPage("home")}>Search Flights</button>
                <button className="footer-link" onClick={() => setPage("login")}>Customer Login</button>
                <button className="footer-link" onClick={() => setPage("admin-login")}>Staff Login</button>
              </div>
            </div>

            <div className="footer-meta">
              <span>LeedsAir</span>
              <span>(c) 2026 LeedsAir. Platform for flight booking and customer self-service.</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
