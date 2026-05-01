import { useState } from "react";
import { AuthProvider } from "./context/AuthContext";
import { Navbar } from "./components/Navbar";

// Pages
import { HomePage }           from "./pages/HomePage";
import { FlightResultsPage }  from "./pages/FlightResultsPage";
import { BookingsPage }       from "./pages/BookingsPage";
import { ManageBookingPage }  from "./pages/ManageBookingPage";
import { LoginPage }          from "./pages/LoginPage";
import { RegisterPage }       from "./pages/RegisterPage";
import { AccountPage }        from "./pages/AccountPage";
import { RewardsPage }        from "./pages/RewardsPage";
import { ComplaintPage }      from "./pages/ComplaintPage";
import { CheckInPage }        from "./pages/CheckInPage";
import { AdminLoginPage }     from "./pages/AdminLoginPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { BookingFlowPage }    from "./pages/BookingFlowPage";

import "./Styles.css";

function AppInner() {
  const [page,             setPage]             = useState("home");
  const [searchParams,     setSearchParams]     = useState(null);
  const [selectedFlight,   setSelectedFlight]   = useState(null);
  const [confirmedBooking, setConfirmedBooking] = useState(null);

  function handleSearch(params) {
    setSearchParams(params);
    setPage("results");
  }

  function handleSelectFlight(flightWithFare) {
    // Attach searchParams so BookingFlowPage knows passenger counts
    setSelectedFlight({ ...flightWithFare, searchParams });
    setPage("booking-flow");
  }

  function handleBookingComplete(booking) {
    setConfirmedBooking(booking);
    setSelectedFlight(null);
    setSearchParams(null);
    setPage("home");
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
      case "bookings":        return <BookingsPage />;
      case "manage":          return <ManageBookingPage onNavigate={setPage} />;
      case "checkin":         return <CheckInPage />;
      case "login":           return <LoginPage onNavigate={setPage} />;
      case "register":        return <RegisterPage onNavigate={setPage} />;
      case "account":         return <AccountPage onNavigate={setPage} />;
      case "rewards":         return <RewardsPage onNavigate={setPage} />;
      case "complaint":       return <ComplaintPage />;
      case "admin-login":     return <AdminLoginPage onNavigate={setPage} />;
      case "admin-dashboard": return <AdminDashboardPage onNavigate={setPage} />;
      default:                return <HomePage onSearch={handleSearch} />;
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
            <span>© 2025 LeedsAir. All rights reserved.</span>
            <div className="footer-links">
              <button className="footer-link" onClick={() => setPage("complaint")}>Submit Complaint</button>
              <button className="footer-link" onClick={() => setPage("admin-login")}>Staff Login</button>
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