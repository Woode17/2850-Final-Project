export const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api";

export function buildApiUrl(path) {
  return `${BASE_URL}${path}`;
}

function normalizeErrorMessage(message, path) {
  if (!message) return "Something went wrong. Please try again.";
  if (message.includes("Failed to fetch")) {
    return "We couldn't reach the server. Check that the backend is running and try again.";
  }
  if (path.startsWith("/bookings/lookup") && message === "Booking not found") {
    return "We couldn't find a booking that matches that reference and last name.";
  }
  if (path.startsWith("/bookings/lookup") && message === "Missing ref or lastName") {
    return "Enter both your booking reference and last name to continue.";
  }
  if (message === "Booking not found") {
    return "This booking could not be found anymore. Refresh and try again.";
  }
  if (message === "Cancelled bookings cannot be modified") {
    return "This booking has already been cancelled, so changes are no longer available.";
  }
  if (message === "Cancelled bookings cannot be checked in") {
    return "Cancelled bookings cannot be checked in.";
  }
  if (message === "Checked-in bookings cannot be cancelled") {
    return "This booking has already been checked in and can no longer be cancelled online.";
  }
  return message;
}

// ── Helpers ──────────────────────────────────────────────
async function request(path, options = {}, authTokenKey = "token") {
  const token = authTokenKey ? localStorage.getItem(authTokenKey) : null;
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(buildApiUrl(path), { ...options, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      message = err.message || err.error || message;
    } catch {}
    throw new Error(normalizeErrorMessage(message, path));
  }
  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────
export async function login(email, password) {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function register(data) {
  return request("/auth/register", { method: "POST", body: JSON.stringify(data) });
}

export async function getProfile() {
  return request("/auth/profile");
}

// ── Flights ───────────────────────────────────────────────
export async function getFlights(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/flights${query ? `?${query}` : ""}`);
}

// ── Bookings ──────────────────────────────────────────────
export async function getBookings(userId = 1) {
  const query = new URLSearchParams({ userId: String(userId) }).toString();
  return request(`/bookings?${query}`);
}

export async function getBookingByRef(ref, lastName) {
  return request(`/bookings/lookup?ref=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(lastName)}`);
}

export async function createBooking(data) {
  return request("/bookings", { method: "POST", body: JSON.stringify(data) });
}

export async function modifyBooking(id, data) {
  return request(`/bookings/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export async function cancelBooking(id, data = null) {
  return request(`/bookings/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify(data ?? {}),
  });
}

export async function checkIn(id) {
  return request(`/bookings/${id}/checkin`, { method: "POST" });
}

// ── Loyalty / Rewards ─────────────────────────────────────
export async function getLoyalty() {
  return request("/loyalty");
}

export async function redeemPoints(data) {
  return request("/loyalty/redeem", { method: "POST", body: JSON.stringify(data) });
}

// ── Complaints ────────────────────────────────────────────
export async function submitComplaint(data) {
  return request("/complaints", { method: "POST", body: JSON.stringify(data) });
}


// ── Admin-specific request (uses adminToken) ──────────────
async function adminRequest(path, options = {}) {
  return request(path, options, "adminToken");
}

// ── Admin ─────────────────────────────────────────────────
export async function adminLogin(username, password) {
  return request("/admin/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }, null);
}

export async function adminGetBookings(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  return adminRequest(`/admin/bookings${query ? `?${query}` : ""}`);
}

export async function adminGetReports() {
  return adminRequest("/admin/reports");
}

export async function adminGetMetrics() {
  return adminRequest("/admin/metrics");
}

export async function adminGetComplaints() {
  return adminRequest("/admin/complaints");
}

export async function adminResolveModificationRequest(requestId, data) {
  return adminRequest(`/admin/modification-requests/${requestId}/decision`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
