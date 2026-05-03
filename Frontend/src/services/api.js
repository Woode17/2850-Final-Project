export const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api";

export function buildApiUrl(path) {
  return `${BASE_URL}${path}`;
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
    throw new Error(message);
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
  // Strip out empty/undefined values so they don't appear as ?key= in the URL
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null)
  );
  const query = new URLSearchParams(clean).toString();
  return request(`/flights${query ? `?${query}` : ""}`);
}
 
// ── Bookings ──────────────────────────────────────────────
 
// Ktor's GET /api/bookings expects ?userId=<integer> not a Bearer token lookup
// We read the stored user object to get the numeric id
export async function getBookings() {
  try {
    const stored = localStorage.getItem("user");
    const user   = stored ? JSON.parse(stored) : null;
    const userId = user?.id ?? 1;
    return request(`/bookings?userId=${encodeURIComponent(userId)}`);
  } catch {
    return request("/bookings");
  }
}
 
export async function getBookingByRef(ref, lastName) {
  return request(
    `/bookings/lookup?ref=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(lastName)}`
  );
}
 
// BookingCreateRequest (Kotlin):
//   userId: Int? — null for guests
//   flightId: String — numeric string e.g. "1"
//   travelClass: String
//   seat: String
//   extras: List<String>
//   totalPrice: Double
//   passenger: Passenger? — { firstName, lastName, dateOfBirth, passportNumber, email, phone }
//   passengers: List<Passenger>
export async function createBooking(data) {
  // Read logged-in user id — null for guests
  let userId = null;
  try {
    const stored = localStorage.getItem("user");
    const u = stored ? JSON.parse(stored) : null;
    userId = u?.id ?? null;
  } catch {}
 
  const lead = data.passenger || data.passengers?.[0] || {};
 
  // Build passenger objects matching Kotlin Passenger data class
  const buildPassenger = (p) => ({
    firstName:      p.firstName      || "",
    lastName:       p.lastName       || "",
    dateOfBirth:    p.dateOfBirth    || "",
    passportNumber: p.passportNumber || "",
    email:          p.email          || "",
    phone:          p.phone          || "",
  });
 
  const passengersList = (data.passengers?.length ? data.passengers : [lead])
    .map(buildPassenger);
 
  const payload = {
    userId,                                    // Int? — null for guests
    flightId:    String(data.flightId ?? ""),  // String — Ktor calls .toIntOrNull() on it
    travelClass: data.travelClass || "Economy",
    seat:        data.seat || data.seats?.[0] || "",
    extras:      data.extras || [],
    totalPrice:  data.totalPrice ?? 0,
    passenger:   buildPassenger(lead),         // Passenger? — lead passenger
    passengers:  passengersList,               // List<Passenger> — all passengers
  };
 
  return request("/bookings", { method: "POST", body: JSON.stringify(payload) });
}
 
// Ktor expects the booking id as an integer in the URL
export async function modifyBooking(id, data) {
  const numericId = typeof id === "string" ? parseInt(id.replace(/\D/g, ""), 10) : id;
  return request(`/bookings/${numericId}`, { method: "PUT", body: JSON.stringify(data) });
}
 
export async function cancelBooking(id) {
  const numericId = typeof id === "string" ? parseInt(id.replace(/\D/g, ""), 10) : id;
  return request(`/bookings/${numericId}/cancel`, { method: "POST" });
}
 
export async function checkIn(id) {
  const numericId = typeof id === "string" ? parseInt(id.replace(/\D/g, ""), 10) : id;
  return request(`/bookings/${numericId}/checkin`, { method: "POST" });
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
  const token = localStorage.getItem("adminToken");
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
 
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(await parseError(res));
  if (res.status === 204) return null;
  return res.json();
}
 
// ── Admin complaints ─────────────────────────────────────
export async function getComplaints() {
  return adminRequest("/admin/complaints");
}
 
// ── Modification requests ─────────────────────────────────
// Uses PUT /api/bookings/{id} — sets status to Pending with requestType
// so the existing Ktor modifyBooking endpoint handles it
export async function requestModification(bookingId, data) {
  return modifyBooking(bookingId, {
    status: "Pending",
    requestType: data.requestType,
    description: data.description,
    // date change fields
    newDate: data.newDate || null,
    newFlightNumber: data.newFlightNumber || null,
    changeCost: data.changeCost || null,
    // name change fields
    newFirstName: data.newFirstName || null,
    newLastName: data.newLastName || null,
    passengerIndex: data.passengerIndex ?? 0,
  });
}
 
// Admin: get pending modifications by filtering GET /api/admin/bookings
// No new endpoint needed — filter bookings with status Pending client-side
export async function adminGetModifications() {
  const bookings = await adminRequest("/admin/bookings");
  return (Array.isArray(bookings) ? bookings : [])
    .filter(b => b.status === "Pending" && b.modificationRequested)
    .map(b => ({
      // Shape to match what the modifications tab expects
      id: b.id,
      bookingId: b.id,
      bookingReference: b.bookingReference,
      requestType: b.modificationRequested,
      description: b.modificationDescription || "",
      status: "pending",
      createdAt: b.modificationRequestedAt || b.createdAt,
      newDate: b.newDate || null,
      newFlightNumber: b.newFlightNumber || null,
      changeCost: b.changeCost || null,
      newFirstName: b.newFirstName || null,
      newLastName: b.newLastName || null,
      booking: b,
    }));
}
 
// Admin: approve — apply the actual change and restore status to Confirmed
// NOTE: Ktor BookingModifyRequest currently accepts: status, totalPrice,
// description, requestType. Ask backend to add newFirstName, newLastName,
// newDate fields to BookingModifyRequest so these persist properly.
export async function adminApproveModification(mod) {
  const bookingId = mod.bookingId || mod.id;
 
  // Build the payload with all fields — Ktor ignores unknown ones for now
  // but when backend adds the fields they will automatically start working
  const payload = {
    status: "Confirmed",
    requestType: mod.requestType,
    modificationRequested: null,
    description: `APPROVED: ${mod.description || ""}`,
  };
 
  // Date change — send newDate, newFlightNumber, updated totalPrice
  if (mod.requestType === "date_change") {
    if (mod.newDate)          payload.newDate          = mod.newDate;
    if (mod.newFlightNumber)  payload.newFlightNumber  = mod.newFlightNumber;
    if (mod.changeCost)       payload.totalPrice       = (mod.booking?.totalPrice || 0) + Number(mod.changeCost);
  }
 
  // Name change — send newFirstName, newLastName, passengerIndex
  if (mod.requestType === "name_change") {
    if (mod.newFirstName)     payload.newFirstName     = mod.newFirstName;
    if (mod.newLastName)      payload.newLastName      = mod.newLastName;
    payload.passengerIndex = mod.passengerIndex ?? 0;
  }
 
  return modifyBooking(bookingId, payload);
}
 
// Admin: reject — restore status to Confirmed, no changes applied
export async function adminRejectModification(mod) {
  const bookingId = mod.bookingId || mod.id;
  return modifyBooking(bookingId, {
    status: "Confirmed",
    requestType: mod.requestType,
    modificationRequested: null,
    description: `REJECTED: ${mod.description || ""}`,
  });
}
 
// ── Admin ─────────────────────────────────────────────────
export async function adminLogin(username, password) {
  return adminRequest("/admin/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
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
 