import { useState, useEffect, useMemo } from "react";
import {
  adminGetBookings,
  adminGetComplaints,
  adminGetMetrics,
  adminGetReports,
  adminResolveModificationRequest,
} from "../services/api";
import { LoadingSpinner, ErrorMessage } from "../components/StatusMessages";

const STATUS_FILTERS = ["All", "Confirmed", "Cancelled", "Pending", "CheckedIn"];

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const headers = ["Reference", "Passenger", "Route", "Date", "Class", "Status", "Cancellation Reason", "Price"];
  const lines = [
    headers.join(","),
    ...rows.map((booking) => [
      booking.bookingReference || booking.id,
      `"${(booking.passenger?.firstName || "")} ${(booking.passenger?.lastName || "")}"`,
      `"${booking.flight?.from || booking.from || ""} -> ${booking.flight?.to || booking.to || ""}"`,
      booking.flight?.departureDate || booking.departureDate || "",
      booking.travelClass || "Economy",
      booking.status || "Confirmed",
      `"${booking.cancellationReason || ""}"`,
      booking.totalPrice || "",
    ].join(",")),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

function BarChart({ data, labelKey, valueKey, prefix = "", color = "var(--sky)" }) {
  if (!data?.length) return <p className="muted-text">No data available.</p>;
  const max = Math.max(...data.map((row) => row[valueKey] || 0));

  return (
    <div className="bar-chart">
      {data.map((row, index) => (
        <div key={`${row[labelKey]}-${index}`} className="bar-row">
          <span className="bar-label">{row[labelKey]}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${max ? ((row[valueKey] || 0) / max) * 100 : 0}%`, background: color }}
            />
          </div>
          <span className="bar-value">{prefix}{(row[valueKey] ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ value, label, icon, highlight }) {
  return (
    <div className={`metric-card ${highlight ? "metric-card--highlight" : ""}`}>
      {icon && <span className="metric-icon">{icon}</span>}
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function formatRequestType(type) {
  if (!type) return "General";
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AdminDashboardPage({ onNavigate }) {
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [reports, setReports] = useState(null);
  const [complaints, setComplaints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [decisionNotes, setDecisionNotes] = useState({});
  const [decisionLoadingId, setDecisionLoadingId] = useState(null);
  const [decisionMessage, setDecisionMessage] = useState(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  async function refreshDashboardData(includeReports = false) {
    const [bookingsData, metricsData, reportsData] = await Promise.all([
      adminGetBookings(),
      adminGetMetrics(),
      includeReports ? adminGetReports() : Promise.resolve(null),
    ]);
    setBookings(bookingsData);
    setMetrics(metricsData);
    if (includeReports && reportsData) {
      setReports(reportsData);
    }
  }

  useEffect(() => {
    if (!localStorage.getItem("adminToken")) onNavigate("admin-login");
  }, [onNavigate]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [bookingsData, metricsData] = await Promise.all([
          adminGetBookings(),
          adminGetMetrics(),
        ]);
        if (!cancelled) {
          setBookings(bookingsData);
          setMetrics(metricsData);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tab !== "reports" || reports) return;
    let cancelled = false;

    adminGetReports()
      .then((data) => {
        if (!cancelled) setReports(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => { cancelled = true; };
  }, [tab, reports]);

  useEffect(() => {
    if (tab !== "complaints" || complaints) return;
    let cancelled = false;

    adminGetComplaints()
      .then((data) => {
        if (!cancelled) setComplaints(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => { cancelled = true; };
  }, [tab, complaints]);

  function handleLogout() {
    localStorage.removeItem("adminToken");
    onNavigate("home");
  }

  async function handleDecision(requestId, decision) {
    setDecisionLoadingId(requestId);
    setDecisionMessage(null);
    setError(null);
    try {
      await adminResolveModificationRequest(requestId, {
        decision,
        note: decisionNotes[requestId] || "",
      });
      await refreshDashboardData(Boolean(reports));
      setDecisionNotes((current) => ({ ...current, [requestId]: "" }));
      setDecisionMessage(`Request ${decision} successfully.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDecisionLoadingId(null);
    }
  }

  const filtered = useMemo(() => bookings.filter((booking) => {
    if (statusFilter !== "All" && booking.status !== statusFilter) return false;
    if (dateFilter && (booking.flight?.departureDate || booking.departureDate || "") !== dateFilter) return false;
    if (routeFilter) {
      const route = `${booking.flight?.from || booking.from || ""} ${booking.flight?.to || booking.to || ""}`.toLowerCase();
      if (!route.includes(routeFilter.toLowerCase())) return false;
    }
    if (search) {
      const term = search.toLowerCase();
      const ref = String(booking.bookingReference || booking.id || "").toLowerCase();
      const passenger = `${booking.passenger?.firstName || ""} ${booking.passenger?.lastName || ""}`.toLowerCase();
      const flightNumber = String(booking.flight?.flightNumber || "").toLowerCase();
      if (!ref.includes(term) && !passenger.includes(term) && !flightNumber.includes(term)) return false;
    }
    return true;
  }), [bookings, statusFilter, dateFilter, routeFilter, search]);

  const modifications = useMemo(() => bookings.flatMap((booking) =>
    (booking.requestHistory || [])
      .filter((request) => request.status?.toLowerCase() === "pending")
      .map((request) => ({ booking, request }))
  ), [bookings]);

  const uniqueRoutes = useMemo(() => {
    const routeSet = new Set();
    bookings.forEach((booking) => {
      const route = `${booking.flight?.from || booking.from || ""}-${booking.flight?.to || booking.to || ""}`;
      if (route !== "-") routeSet.add(route);
    });
    return ["", ...Array.from(routeSet)];
  }, [bookings]);

  return (
    <div className="page admin-page">
      <div className="admin-topbar">
        <div className="admin-brand">
          <span>Admin</span>
          <strong>LeedsAir Admin</strong>
        </div>
        <div className="admin-tabs">
          {[
            ["bookings", "Bookings"],
            ["reports", "Reports"],
            ["modifications", "Modifications"],
            ["complaints", "Complaints"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`admin-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "modifications" && modifications.length > 0 && (
                <span className="admin-badge">{modifications.length}</span>
              )}
              {key === "complaints" && (complaints?.length || 0) > 0 && (
                <span className="admin-badge">{complaints.length}</span>
              )}
            </button>
          ))}
        </div>
        <button className="logout-btn" onClick={handleLogout}>Sign Out</button>
      </div>

      <div className="admin-body">
        {loading && <LoadingSpinner message="Loading admin data..." />}
        {error && <ErrorMessage message={error} />}
        {decisionMessage && (
          <div className="confirmation-banner admin-confirmation-banner">
            <p>{decisionMessage}</p>
          </div>
        )}

        {!loading && !error && tab === "bookings" && (
          <>
            {metrics && (
              <div className="admin-metrics">
                <MetricCard icon="Tickets" value={metrics.totalBookings ?? bookings.length} label="Total Bookings" />
                <MetricCard icon="Cancel" value={metrics.cancellations ?? "-"} label="Cancellations" />
                <MetricCard icon="Revenue" value={`£${(metrics.totalRevenue ?? 0).toLocaleString()}`} label="Total Revenue" highlight />
                <MetricCard icon="Route" value={metrics.popularRoute ?? "-"} label="Top Route" />
                <MetricCard icon="Users" value={metrics.activeUsers ?? "-"} label="Active Users" />
                <MetricCard icon="Rate" value={`${metrics.cancellationRate ?? "-"}%`} label="Cancellation Rate" />
              </div>
            )}

            <div className="admin-filters-bar">
              <input
                className="admin-search"
                placeholder="Search reference, passenger, flight no..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <input
                type="date"
                className="admin-date-filter"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                title="Filter by departure date"
              />
              <select
                className="admin-route-filter"
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
              >
                <option value="">All routes</option>
                {uniqueRoutes.filter(Boolean).map((route) => (
                  <option key={route} value={route.replace("-", " ")}>{route}</option>
                ))}
              </select>
              <div className="status-filter-group">
                {STATUS_FILTERS.map((status) => (
                  <button
                    key={status}
                    className={`filter-chip ${statusFilter === status ? "active" : ""}`}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
              <button
                className="admin-clear-btn"
                onClick={() => {
                  setSearch("");
                  setDateFilter("");
                  setRouteFilter("");
                  setStatusFilter("All");
                }}
              >
                Clear filters
              </button>
            </div>

            <div className="admin-results-bar">
              <span className="admin-results-count">
                Showing <strong>{filtered.length}</strong> of <strong>{bookings.length}</strong> bookings
              </span>
              <button
                className="export-btn"
                onClick={() => exportCSV(filtered, "leedsair-bookings.csv")}
              >
                Export CSV
              </button>
            </div>

            <div className="admin-table-wrapper">
              <div className="admin-table-header">
                <span>Reference</span>
                <span>Passenger</span>
                <span>Route</span>
                <span>Date</span>
                <span>Class</span>
                <span>Price</span>
                <span>Status</span>
              </div>

              {filtered.length === 0 && (
                <div className="empty-state"><p>No bookings match your filters.</p></div>
              )}

              {filtered.map((booking) => (
                <div key={booking.id || booking.bookingReference}>
                  <div
                    className="admin-table-row admin-table-row--clickable"
                    onClick={() => setExpandedId(expandedId === (booking.id || booking.bookingReference) ? null : (booking.id || booking.bookingReference))}
                  >
                    <span className="ref-value">{booking.bookingReference || booking.id}</span>
                    <span>{booking.passenger?.firstName} {booking.passenger?.lastName}</span>
                    <span>{booking.flight?.from || booking.from} - {booking.flight?.to || booking.to}</span>
                    <span>{booking.flight?.departureDate || booking.departureDate || "-"}</span>
                    <span>{booking.travelClass || "Economy"}</span>
                    <span>£{booking.totalPrice ?? "-"}</span>
                    <span className={`status-badge status-${(booking.status || "confirmed").toLowerCase()}`}>
                      {booking.status || "Confirmed"}
                    </span>
                  </div>

                  {expandedId === (booking.id || booking.bookingReference) && (
                    <div className="admin-row-detail">
                      <div className="admin-detail-grid">
                        <div><span>Flight</span><strong>{booking.flight?.flightNumber || "-"}</strong></div>
                        <div><span>Departure</span><strong>{booking.flight?.departureTime || "-"}</strong></div>
                        <div><span>Arrival</span><strong>{booking.flight?.arrivalTime || "-"}</strong></div>
                        <div><span>Seat</span><strong>{booking.seat || "Auto-assigned"}</strong></div>
                        <div><span>Checked In</span><strong>{booking.checkedIn ? "Yes" : "No"}</strong></div>
                        <div><span>Email</span><strong>{booking.passenger?.email || "-"}</strong></div>
                        <div><span>Booked</span><strong>{booking.createdAt ? new Date(booking.createdAt).toLocaleDateString("en-GB") : "-"}</strong></div>
                        <div><span>Cancellation Reason</span><strong>{booking.cancellationReason || "-"}</strong></div>
                      </div>
                      {booking.requestHistory?.length > 0 && (
                        <div className="admin-detail-extras">
                          Latest request: {formatRequestType(booking.requestHistory[0].requestType)} ({booking.requestHistory[0].status})
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && !error && tab === "reports" && (
          <div className="reports-section">
            <div className="reports-header-row">
              <h2>Reports</h2>
              <button
                className="export-btn"
                onClick={() => exportCSV(bookings, "leedsair-full-report.csv")}
              >
                Export all bookings CSV
              </button>
            </div>

            {!reports && <LoadingSpinner message="Generating reports..." />}

            {reports && (
              <>
                <div className="admin-metrics" style={{ marginBottom: "2rem" }}>
                  <MetricCard icon="Rate" value={`${reports.cancellationRate ?? "-"}%`} label="Cancellation Rate" />
                  <MetricCard icon="Peak" value={reports.peakBookingHour ?? "-"} label="Peak Booking Hour" />
                  <MetricCard icon="Route" value={reports.popularRoutes?.[0]?.route ?? "-"} label="Most Popular Route" highlight />
                  <MetricCard icon="Revenue" value={`£${(reports.revenuePerRoute?.[0]?.revenue ?? 0).toLocaleString()}`} label="Top Route Revenue" />
                  <MetricCard icon="Loyalty" value={reports.loyaltyMix?.[0]?.count ?? 0} label="Loyalty Bookings" />
                </div>

                <div className="reports-grid">
                  <div className="report-card">
                    <h3>Bookings per Flight</h3>
                    <BarChart data={reports.bookingsPerFlight} labelKey="flightNumber" valueKey="count" color="var(--sky)" />
                  </div>

                  <div className="report-card">
                    <h3>Most Popular Routes</h3>
                    <BarChart data={reports.popularRoutes} labelKey="route" valueKey="count" color="#7c3aed" />
                  </div>

                  <div className="report-card">
                    <h3>Revenue per Route</h3>
                    <BarChart data={reports.revenuePerRoute} labelKey="route" valueKey="revenue" prefix="£" color="var(--success)" />
                  </div>

                  <div className="report-card report-card--center">
                    <h3>Cancellation Rate</h3>
                    <div className="cancellation-gauge">
                      <svg viewBox="0 0 120 70" className="gauge-svg">
                        <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#e5e7eb" strokeWidth="12" strokeLinecap="round" />
                        <path
                          d="M10,60 A50,50 0 0,1 110,60"
                          fill="none"
                          stroke={reports.cancellationRate > 20 ? "#ef4444" : reports.cancellationRate > 10 ? "#f59e0b" : "#22c55e"}
                          strokeWidth="12"
                          strokeLinecap="round"
                          strokeDasharray={`${(reports.cancellationRate / 100) * 157} 157`}
                        />
                      </svg>
                      <div className="gauge-value">{reports.cancellationRate ?? "-"}%</div>
                      <div className="gauge-label">of all bookings cancelled</div>
                    </div>
                  </div>

                  <div className="report-card">
                    <h3>Revenue Trend</h3>
                    <BarChart data={reports.monthlyRevenue} labelKey="month" valueKey="revenue" prefix="£" color="#0f766e" />
                  </div>

                  <div className="report-card">
                    <h3>Bookings by Status</h3>
                    <BarChart data={reports.bookingsByStatus} labelKey="label" valueKey="count" color="#1d4ed8" />
                  </div>

                  <div className="report-card">
                    <h3>Cancellation Reasons</h3>
                    <BarChart data={reports.cancellationReasons} labelKey="label" valueKey="count" color="#dc2626" />
                  </div>

                  <div className="report-card">
                    <h3>Loyalty Member Activity</h3>
                    <BarChart data={reports.loyaltyMix} labelKey="label" valueKey="count" color="#7c3aed" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {!loading && !error && tab === "modifications" && (
          <div className="modifications-section">
            <h2>Modification Requests</h2>
            <p className="section-subtitle">
              Bookings with pending change requests or awaiting admin approval.
            </p>

            {modifications.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✓</span>
                <p>No pending modification requests.</p>
              </div>
            ) : (
              <div className="admin-table-wrapper">
                <div className="admin-table-header" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1.2fr 1.6fr" }}>
                  <span>Reference</span>
                  <span>Passenger</span>
                  <span>Route</span>
                  <span>Type</span>
                  <span>Requested</span>
                  <span>Actions</span>
                </div>
                {modifications.map(({ booking, request }) => (
                  <div className="admin-modification-row" key={`${booking.id || booking.bookingReference}-${request.id}`}>
                    <div className="admin-table-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1.2fr 1.6fr" }}>
                      <span className="ref-value">{booking.bookingReference || booking.id}</span>
                      <span>{booking.passenger?.firstName} {booking.passenger?.lastName}</span>
                      <span>{booking.flight?.from || booking.from} - {booking.flight?.to || booking.to}</span>
                      <span>{formatRequestType(request.requestType)}</span>
                      <span>{request.createdAt ? new Date(request.createdAt).toLocaleString("en-GB") : "-"}</span>
                      <span className="admin-action-btns">
                        <button
                          className="admin-approve-btn"
                          onClick={() => handleDecision(request.id, "approved")}
                          disabled={decisionLoadingId === request.id}
                        >
                          {decisionLoadingId === request.id ? "Saving..." : "Approve"}
                        </button>
                        <button
                          className="admin-reject-btn"
                          onClick={() => handleDecision(request.id, "rejected")}
                          disabled={decisionLoadingId === request.id}
                        >
                          {decisionLoadingId === request.id ? "Saving..." : "Reject"}
                        </button>
                      </span>
                    </div>
                    <div className="admin-modification-detail">
                      <p className="admin-modification-description">
                        {request.description || "No customer note was provided for this request."}
                      </p>
                      <textarea
                        className="admin-note-input"
                        rows={3}
                        placeholder="Optional admin note for this decision"
                        value={decisionNotes[request.id] || ""}
                        onChange={(e) =>
                          setDecisionNotes((current) => ({
                            ...current,
                            [request.id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: "2rem" }}>
              <h3 style={{ marginBottom: "1rem" }}>Change Tracking Summary</h3>
              <div className="admin-metrics">
                <MetricCard icon="Changes" value={modifications.length} label="Pending Changes" />
                <MetricCard icon="Cancel" value={bookings.filter((booking) => booking.status === "Cancelled").length} label="Cancellations" />
                <MetricCard icon="Boarded" value={bookings.filter((booking) => booking.checkedIn).length} label="Checked In" />
                <MetricCard icon="Confirmed" value={bookings.filter((booking) => booking.status === "Confirmed").length} label="Confirmed" />
              </div>
            </div>
          </div>
        )}

        {!loading && !error && tab === "complaints" && (
          <div className="modifications-section">
            <h2>Customer Complaints</h2>
            <p className="section-subtitle">
              Review submitted complaints from customers and follow up by booking reference.
            </p>

            {!complaints && <LoadingSpinner message="Loading complaints..." />}

            {complaints && complaints.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">✓</span>
                <p>No complaints submitted yet.</p>
              </div>
            )}

            {complaints && complaints.length > 0 && (
              <div className="admin-table-wrapper">
                <div className="admin-table-header" style={{ gridTemplateColumns: "0.7fr 1fr 1fr 0.8fr 0.9fr 1.8fr" }}>
                  <span>ID</span>
                  <span>Customer</span>
                  <span>Booking</span>
                  <span>Status</span>
                  <span>Submitted</span>
                  <span>Complaint</span>
                </div>
                {complaints.map((complaint) => (
                  <div className="admin-table-row" style={{ gridTemplateColumns: "0.7fr 1fr 1fr 0.8fr 0.9fr 1.8fr" }} key={complaint.id}>
                    <span className="ref-value">CMP{String(complaint.id).padStart(6, "0")}</span>
                    <span>
                      <strong>{complaint.customerName || "Guest customer"}</strong>
                      <br />
                      <small>{complaint.customerEmail || "-"}</small>
                    </span>
                    <span>{complaint.bookingReference || "Not provided"}</span>
                    <span className={`status-badge status-${String(complaint.status || "open").toLowerCase()}`}>
                      {complaint.status || "Open"}
                    </span>
                    <span>{complaint.createdAt ? new Date(complaint.createdAt).toLocaleString("en-GB") : "-"}</span>
                    <span>
                      <strong>{complaint.subject || "General complaint"}</strong>
                      <br />
                      <small>{complaint.message || "No details provided."}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
