import { useEffect, useMemo, useState } from "react";
import {
  cancelBooking,
  checkIn,
  getBookingByRef,
  getFlights,
  modifyBooking,
} from "../services/api";
import { LoadingSpinner, ErrorMessage } from "../components/StatusMessages";

const EXTRA_OPTIONS = [
  { id: "priority-boarding", label: "Priority boarding", price: 18 },
  { id: "extra-baggage", label: "Extra 20kg checked bag", price: 42 },
  { id: "lounge-access", label: "Lounge access", price: 35 },
  { id: "travel-insurance", label: "Travel insurance", price: 27 },
];
const DATE_CHANGE_ADMIN_FEE = 10;
const INSURANCE_PDF = "/LeedsAir-Travel-Insurance-Policy.pdf";
const BASE_TAKEN = new Set([
  "4A", "4B", "5C", "6D", "7A", "7F", "8B", "8E", "9C", "10A",
  "11D", "12B", "13E", "14A", "15C", "16F", "17B", "18A", "19D", "20C", "1B", "2D", "3A",
]);
const ROWS_BIZ = [1, 2, 3];
const ROWS_ECO = Array.from({ length: 27 }, (_, i) => i + 4);
const COLS = ["A", "B", "C", "", "D", "E", "F"];

function formatRequestType(type) {
  if (!type) return "General request";
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRequestStatus(status) {
  if (!status) return "Pending";
  return status.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateChangeCostLabel(newFare, currentFare) {
  const safeNewFare = Number(newFare || 0);
  const safeCurrentFare = Number(currentFare || 0);
  const fareIncrease = Math.max(0, safeNewFare - safeCurrentFare);
  const totalCharge = DATE_CHANGE_ADMIN_FEE + fareIncrease;
  return `+£${totalCharge.toFixed(2)} payable`;
}

function getSeatPrice(row, col, isBiz) {
  if (isBiz) {
    if (row === 1) return col === "A" || col === "F" ? 55 : 45;
    if (row === 2) return col === "A" || col === "F" ? 45 : 35;
    return 30;
  }
  if (row <= 6) return col === "A" || col === "F" ? 25 : 18;
  if (row <= 10) return col === "A" || col === "F" ? 20 : 15;
  if (col === "A" || col === "F") return 15;
  if (col === "C" || col === "D") return 8;
  return 6;
}

function SeatMap({ selectedSeat, onSelectSeat, travelClass = "economy" }) {
  const isBizBooking = String(travelClass).toLowerCase() === "business";
  const takenOrChosen = new Set([...BASE_TAKEN]);

  function renderSeat(row, col) {
    if (!col) return <div key={`aisle-${row}`} className="seat-aisle" />;
    const id = `${row}${col}`;
    const isBiz = row <= 3;
    const isTaken = takenOrChosen.has(id);
    const isLocked = isBizBooking ? !isBiz : isBiz;
    const price = getSeatPrice(row, col, isBiz);
    const isSelected = selectedSeat === id;
    let tier = "";
    if (!isBiz) {
      if (row <= 6) tier = "seat-front";
      else if (col === "A" || col === "F") tier = "seat-window";
      else if (col === "C" || col === "D") tier = "seat-aisle-seat";
    }
    return (
      <button
        key={id}
        type="button"
        disabled={isTaken || isLocked}
        className={[
          "seat",
          isBiz ? "seat-biz" : "seat-eco",
          isTaken ? "seat-taken" : isLocked ? "seat-locked" : "seat-free",
          tier,
          isSelected ? "seat-sel" : "",
        ].filter(Boolean).join(" ")}
        title={isLocked ? "Not your ticket class" : isTaken ? "Already taken" : `${id} — +£${price}`}
        onClick={() => !isTaken && !isLocked && onSelectSeat(isSelected ? "" : id)}
      >
        {isSelected ? "✓" : col}
      </button>
    );
  }

  return (
    <div className="seat-map-wrap">
      <div className="seat-legend seat-legend--top">
        {isBizBooking ? (
          <>
            <span className="legend-item"><span className="seat seat-free seat-biz legend-demo" />Row 1 window £55</span>
            <span className="legend-item"><span className="seat seat-free seat-biz legend-demo" />Row 2 £35-45</span>
            <span className="legend-item"><span className="seat seat-free seat-biz legend-demo" />Row 3 £30</span>
          </>
        ) : (
          <>
            <span className="legend-item"><span className="seat seat-free seat-front legend-demo" />Front £18-25</span>
            <span className="legend-item"><span className="seat seat-free seat-window legend-demo" />Window £15</span>
            <span className="legend-item"><span className="seat seat-free seat-aisle-seat legend-demo" />Aisle £8</span>
            <span className="legend-item"><span className="seat seat-free seat-eco legend-demo" />Middle £6</span>
          </>
        )}
        <span className="legend-item"><span className="seat seat-taken legend-demo" />Taken</span>
        <span className="legend-item"><span className="seat seat-locked legend-demo" />Not your class</span>
      </div>
      <div className="seat-map">
        <div className="seat-col-headers">
          <span className="seat-row-num" />
          {COLS.map((col, i) => col ? <span key={i} className="seat-col-hdr">{col}</span> : <span key={i} className="seat-aisle" />)}
        </div>
        <div className={`cabin-label cabin-biz-label ${!isBizBooking ? "cabin-locked-label" : ""}`}>
          ✦ Business Class {!isBizBooking && "— Economy ticket only"}
        </div>
        {ROWS_BIZ.map((row) => (
          <div className="seat-row" key={row}>
            <span className="seat-row-num">{row}</span>
            {COLS.map((col) => renderSeat(row, col))}
          </div>
        ))}
        <div className="cabin-divider"><span>Economy Class {isBizBooking && "— Business ticket only"}</span></div>
        {ROWS_ECO.map((row) => (
          <div className="seat-row" key={row}>
            <span className="seat-row-num">{row}</span>
            {COLS.map((col) => renderSeat(row, col))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManageBookingPage({ initialLookup, onLookupConsumed }) {
  const [ref, setRef] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [booking, setBooking] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [requestText, setRequestText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [boardingPass, setBoardingPass] = useState(null);
  const [nameChangeValue, setNameChangeValue] = useState("");

  const [dateChangeStep, setDateChangeStep] = useState("choose-date");
  const [newDate, setNewDate] = useState("");
  const [dateFlights, setDateFlights] = useState([]);
  const [flightSearchLoading, setFlightSearchLoading] = useState(false);
  const [selectedNewFlight, setSelectedNewFlight] = useState(null);
  const [dateChangeNote, setDateChangeNote] = useState("");

  const [selectedExtras, setSelectedExtras] = useState([]);
  const [selectedSeat, setSelectedSeat] = useState("");
  const [extrasNote, setExtrasNote] = useState("");

  const bookingStatus = booking?.status || "Confirmed";
  const requestHistory = booking?.requestHistory || [];
  const hasPendingByType = (type) =>
    requestHistory.some(
      (entry) => entry.requestType === type && entry.status?.toLowerCase() === "pending"
    );
  const hasAnyPending = requestHistory.some((entry) => entry.status?.toLowerCase() === "pending");
  const isCancelled = bookingStatus === "Cancelled";
  const isCheckedIn = bookingStatus === "CheckedIn";

  const displayStatus = hasAnyPending && !isCancelled ? "Pending Approval" : bookingStatus;
  const selectedExtraTotal = useMemo(
    () =>
      selectedExtras.reduce((sum, extraId) => {
        const extra = EXTRA_OPTIONS.find((item) => item.id === extraId);
        return sum + (extra?.price || 0);
      }, 0),
    [selectedExtras]
  );

  const currentBookingPrice = Number(booking?.totalPrice || 0);
  const selectedFlightPrice = Number(selectedNewFlight?.price || 0);
  const fareIncrease = Math.max(0, selectedFlightPrice - currentBookingPrice);
  const dateChangeCharge = DATE_CHANGE_ADMIN_FEE + fareIncrease;

  const actionDisabledState = {
    "change-date": !booking || isCancelled || hasPendingByType("date_change"),
    "add-extras": !booking || isCancelled,
    "name-change": !booking || isCancelled || hasPendingByType("name_change"),
    "other-request": !booking || isCancelled || hasPendingByType("other_request"),
    checkin: !booking || isCancelled || isCheckedIn,
    cancel: !booking || isCancelled || isCheckedIn,
  };

  const actionDisabledReason = {
    "change-date": isCancelled
      ? "This booking has already been cancelled."
      : hasPendingByType("date_change")
        ? "A date change request is already pending review."
        : "",
    "add-extras": isCancelled
      ? "This booking has already been cancelled."
      : "",
    "name-change": isCancelled
      ? "This booking has already been cancelled."
      : hasPendingByType("name_change")
        ? "A name change request is already pending review."
        : "",
    "other-request": isCancelled
      ? "This booking has already been cancelled."
      : hasPendingByType("other_request")
        ? "Another custom request is already pending review."
        : "",
    checkin: isCancelled
      ? "Cancelled bookings cannot be checked in."
      : isCheckedIn
        ? "This booking has already been checked in."
        : "",
    cancel: isCancelled
      ? "This booking has already been cancelled."
      : isCheckedIn
        ? "Checked-in bookings can no longer be cancelled online."
        : "",
  };

  useEffect(() => {
    if (!initialLookup?.ref || !initialLookup?.lastName) return;
    setRef(initialLookup.ref);
    setLastName(initialLookup.lastName);
    runLookup(initialLookup.ref, initialLookup.lastName).finally(() => onLookupConsumed?.());
  }, [initialLookup, onLookupConsumed]);

  async function runLookup(lookupRef, lookupLastName) {
    setLoading(true);
    setError(null);
    setBooking(null);
    setActionMessage(null);
    setBoardingPass(null);
    try {
      const data = await getBookingByRef(lookupRef, lookupLastName);
      setBooking(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLookup(e) {
    e.preventDefault();
    await runLookup(ref, lastName);
  }

  async function refreshBooking() {
    if (!ref.trim() || !lastName.trim()) return;
    const data = await getBookingByRef(ref, lastName);
    setBooking(data);
  }

  function resetActionState() {
    setRequestText("");
    setDateChangeStep("choose-date");
    setNewDate("");
    setDateFlights([]);
    setSelectedNewFlight(null);
    setDateChangeNote("");
    setSelectedExtras([]);
    setSelectedSeat("");
    setExtrasNote("");
    setNameChangeValue("");
  }

  function openAction(action) {
    if (actionDisabledState[action]) {
      setError(actionDisabledReason[action] || "This action is not available right now.");
      setActionMessage(null);
      return;
    }
    setActiveAction(action);
    resetActionState();
    setActionMessage(null);
    setBoardingPass(null);
    setError(null);
  }

  async function searchFlightsForDate() {
    if (!booking || !newDate) return;
    setFlightSearchLoading(true);
    setError(null);
    setSelectedNewFlight(null);
    try {
      const flights = await getFlights({
        from: booking.flight?.from || booking.from,
        to: booking.flight?.to || booking.to,
        departureDate: newDate,
      });
      setDateFlights(Array.isArray(flights) ? flights : []);
      setDateChangeStep("choose-flight");
    } catch (err) {
      setError(err.message);
    } finally {
      setFlightSearchLoading(false);
    }
  }

  async function submitDateChangeRequest() {
    if (!booking || !selectedNewFlight || !newDate) {
      setError("Please choose a date and replacement flight.");
      return;
    }
    const description = [
      `Requested departure date: ${newDate}`,
      `Requested flight id: ${selectedNewFlight.id}`,
      `Requested flight: ${selectedNewFlight.flightNumber} (${selectedNewFlight.departureTime} - ${selectedNewFlight.arrivalTime})`,
      `Current booking total: £${currentBookingPrice.toFixed(2)}`,
      `Estimated new fare: £${Number(selectedNewFlight.price || 0).toFixed(2)}`,
      `Admin change fee: £${DATE_CHANGE_ADMIN_FEE.toFixed(2)}`,
      `Fare increase component: £${fareIncrease.toFixed(2)} (no refund applied if fare is lower)`,
      `Total charge estimate: £${dateChangeCharge.toFixed(2)}`,
      dateChangeNote.trim() ? `Customer note: ${dateChangeNote.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await modifyBooking(booking.id, { requestType: "date_change", description });
    await refreshBooking();
    setActiveAction(null);
    setActionMessage("Date change request submitted to admin. Booking is now pending approval.");
  }

  async function submitExtrasRequest() {
    if (!booking || selectedExtras.length === 0) {
      setError("Please select at least one extra.");
      return;
    }
    const extrasLabels = selectedExtras
      .map((extraId) => EXTRA_OPTIONS.find((item) => item.id === extraId))
      .filter(Boolean)
      .map((item) => `${item.label} (£${item.price})`)
      .join(", ");

    const description = [
      `Requested extras: ${extrasLabels}`,
      selectedSeat ? `Seat preference: ${selectedSeat}` : "Seat preference: none selected",
      `Estimated extra total: £${selectedExtraTotal.toFixed(2)}`,
      selectedExtras.includes("travel-insurance")
        ? `Insurance policy link: ${INSURANCE_PDF}`
        : null,
      extrasNote.trim() ? `Customer note: ${extrasNote.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await modifyBooking(booking.id, {
      requestType: "extra_request",
      description,
      totalPrice: Number(booking.totalPrice || 0) + selectedExtraTotal,
    });
    await refreshBooking();
    setActiveAction(null);
    setActionMessage("Extras added successfully. No admin approval required.");
  }

  async function submitNameChangeRequest() {
    if (!booking || !nameChangeValue.trim()) {
      setError("Please enter the new passenger name.");
      return;
    }
    await modifyBooking(booking.id, {
      requestType: "name_change",
      description: `Requested passenger name change to: ${nameChangeValue.trim()}`,
    });
    await refreshBooking();
    setActiveAction(null);
    setActionMessage("Name change request submitted to admin. Booking is now pending approval.");
  }

  async function submitOtherRequest() {
    if (!booking || !requestText.trim()) {
      setError("Please enter your request.");
      return;
    }
    await modifyBooking(booking.id, {
      requestType: "other_request",
      description: requestText.trim(),
    });
    await refreshBooking();
    setActiveAction(null);
    setActionMessage("Your request has been submitted to admin and is pending approval.");
  }

  async function handleSubmitAction() {
    if (!booking) return;
    setActionLoading(true);
    setError(null);
    setActionMessage(null);
    setBoardingPass(null);

    try {
      if (activeAction === "change-date") {
        await submitDateChangeRequest();
      } else if (activeAction === "add-extras") {
        await submitExtrasRequest();
      } else if (activeAction === "name-change") {
        await submitNameChangeRequest();
      } else if (activeAction === "other-request") {
        await submitOtherRequest();
      } else if (activeAction === "cancel") {
        if (!requestText.trim()) throw new Error("Please provide a cancellation reason.");
        const updatedBooking = await cancelBooking(booking.id, { reason: requestText.trim() });
        setBooking(updatedBooking);
        setActionMessage("Booking cancelled.");
      } else if (activeAction === "checkin") {
        const pass = await checkIn(booking.id);
        await refreshBooking();
        setBoardingPass(pass);
        setActionMessage("Check-in completed.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="page manage-page">
      <div className="page-header">
        <h1>Manage Booking</h1>
        <p>Enter your booking reference and last name to access your reservation.</p>
      </div>

      <form className="manage-lookup-form" onSubmit={handleLookup}>
        <div className="form-group">
          <label>Booking Reference</label>
          <input placeholder="e.g. ABC123" value={ref} onChange={(e) => setRef(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Last Name</label>
          <input
            placeholder="Passenger surname"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="search-btn" disabled={loading}>
          {loading ? "Searching..." : "Find Booking"}
        </button>
      </form>

      {loading && <LoadingSpinner message="Looking up booking..." />}
      {error && <ErrorMessage message={error} />}

      {booking && (
        <div className="booking-detail-card">
          <h3>Booking Found</h3>
          <div className="detail-grid">
            <div><span>Reference</span><strong>{booking.bookingReference || booking.id}</strong></div>
            <div><span>Status</span><strong>{displayStatus}</strong></div>
            <div><span>Passenger</span><strong>{booking.passenger?.firstName} {booking.passenger?.lastName}</strong></div>
            <div><span>Email</span><strong>{booking.passenger?.email}</strong></div>
            <div><span>Route</span><strong>{booking.flight?.from || booking.from} → {booking.flight?.to || booking.to}</strong></div>
            <div><span>Departure</span><strong>{booking.flight?.departureDate} · {booking.flight?.departureTime}</strong></div>
            {booking.cancellationReason && <div><span>Cancellation Reason</span><strong>{booking.cancellationReason}</strong></div>}
          </div>

          {(isCancelled || isCheckedIn || hasAnyPending) && (
            <div className="manage-status-banner">
              <strong>Action availability updated</strong>
              <p>
                {isCancelled && "This booking is cancelled, so online changes are now locked."}
                {!isCancelled && isCheckedIn && "This booking is already checked in, so cancellation is locked."}
                {!isCancelled && hasAnyPending && "One or more requests are pending admin review."}
              </p>
            </div>
          )}

          <div className="manage-actions">
            <button className={`action-btn ${activeAction === "change-date" ? "action-btn--active" : ""}`} type="button" onClick={() => openAction("change-date")} disabled={actionDisabledState["change-date"]}>Change Date</button>
            <button className={`action-btn ${activeAction === "add-extras" ? "action-btn--active" : ""}`} type="button" onClick={() => openAction("add-extras")} disabled={actionDisabledState["add-extras"]}>Add Extras</button>
            <button className={`action-btn ${activeAction === "name-change" ? "action-btn--active" : ""}`} type="button" onClick={() => openAction("name-change")} disabled={actionDisabledState["name-change"]}>Name Change</button>
            <button className={`action-btn ${activeAction === "other-request" ? "action-btn--active" : ""}`} type="button" onClick={() => openAction("other-request")} disabled={actionDisabledState["other-request"]}>Other</button>
            <button className={`action-btn checkin-btn ${activeAction === "checkin" ? "action-btn--active" : ""}`} type="button" onClick={() => openAction("checkin")} disabled={actionDisabledState.checkin}>Check In</button>
            <button className={`action-btn cancel-action-btn ${activeAction === "cancel" ? "action-btn--active" : ""}`} type="button" onClick={() => openAction("cancel")} disabled={actionDisabledState.cancel}>Cancel Flight</button>
          </div>

          {activeAction === "change-date" && (
            <div className="manage-action-panel">
              <h4>Change date and flight</h4>
              <p>Select your new date, choose a flight, then submit for admin approval.</p>
              {dateChangeStep === "choose-date" && (
                <>
                  <div className="form-group">
                    <label>New departure date</label>
                    <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  </div>
                  <div className="manage-action-buttons">
                    <button type="button" className="flow-back-btn" onClick={() => setActiveAction(null)}>Close</button>
                    <button type="button" className="flow-next-btn" disabled={!newDate || flightSearchLoading} onClick={searchFlightsForDate}>
                      {flightSearchLoading ? "Searching..." : "Find flights"}
                    </button>
                  </div>
                </>
              )}
              {dateChangeStep === "choose-flight" && (
                <>
                  <div className="manage-history-list">
                    {dateFlights.length === 0 && <p className="manage-history-empty">No flights found for this date.</p>}
                    {dateFlights.map((flight) => (
                      <label key={flight.id} className="extra-card" style={{ cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="replacement-flight"
                          checked={selectedNewFlight?.id === flight.id}
                          onChange={() => setSelectedNewFlight(flight)}
                        />
                        <div className="extra-info">
                          <strong>{flight.flightNumber} · {flight.departureTime} - {flight.arrivalTime}</strong>
                          <div className="extra-price">Estimated fare: £{flight.price}</div>
                        </div>
                        <span className="status-badge status-pending">
                          {dateChangeCostLabel(flight.price, booking.totalPrice)}
                        </span>
                      </label>
                    ))}
                  </div>
                  {selectedNewFlight && (
                    <div className="flow-running-total">
                      Current booking: <strong>£{currentBookingPrice.toFixed(2)}</strong> · New fare:
                      <strong> £{selectedFlightPrice.toFixed(2)}</strong> · Admin fee:
                      <strong> £{DATE_CHANGE_ADMIN_FEE.toFixed(2)}</strong> · Fare increase:
                      <strong> £{fareIncrease.toFixed(2)}</strong> · Total charge:
                      <strong> £{dateChangeCharge.toFixed(2)}</strong>
                    </div>
                  )}
                  <textarea
                    className="manage-action-textarea"
                    value={dateChangeNote}
                    onChange={(e) => setDateChangeNote(e.target.value)}
                    rows={4}
                    placeholder="Optional note for admin..."
                  />
                  <div className="manage-action-buttons">
                    <button type="button" className="flow-back-btn" onClick={() => setDateChangeStep("choose-date")}>Back</button>
                    <button type="button" className="flow-next-btn" onClick={handleSubmitAction} disabled={actionLoading || !selectedNewFlight}>
                      {actionLoading ? "Submitting..." : "Submit request"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeAction === "add-extras" && (
            <div className="manage-action-panel">
              <h4>Add extras</h4>
              <p>Select extras to add immediately to this booking.</p>
              <div className="extras-grid">
                {EXTRA_OPTIONS.map((extra) => {
                  const isSelected = selectedExtras.includes(extra.id);
                  return (
                    <label key={extra.id} className={`extra-card ${isSelected ? "extra-card--selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedExtras((current) => [...current, extra.id]);
                          else setSelectedExtras((current) => current.filter((value) => value !== extra.id));
                        }}
                      />
                      <div className="extra-info">
                        <span className="extra-label">{extra.label}</span>
                        <span className="extra-price">£{extra.price}</span>
                        {extra.id === "travel-insurance" && (
                          <small>
                            Covers cancellation, delays and lost baggage.{" "}
                            <a href={INSURANCE_PDF} target="_blank" rel="noreferrer">View policy PDF</a>{" · "}
                            <a href={INSURANCE_PDF} download>Download PDF</a>
                          </small>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              <h4 style={{ marginTop: "1rem" }}>Seat selection</h4>
              <p>Select your preferred seat using the plane map.</p>
              <SeatMap
                selectedSeat={selectedSeat}
                onSelectSeat={setSelectedSeat}
                travelClass={booking.travelClass || "economy"}
              />
              <textarea
                className="manage-action-textarea"
                value={extrasNote}
                onChange={(e) => setExtrasNote(e.target.value)}
                rows={3}
                placeholder="Optional note for admin..."
              />
              <div className="flow-running-total">
                Extra total estimate: <strong>£{selectedExtraTotal.toFixed(2)}</strong>
                {selectedSeat && <> · Selected seat: <strong>{selectedSeat}</strong></>}
              </div>
              <div className="manage-action-buttons">
                <button type="button" className="flow-back-btn" onClick={() => setActiveAction(null)}>Close</button>
                <button type="button" className="flow-next-btn" onClick={handleSubmitAction} disabled={actionLoading || selectedExtras.length === 0}>
                  {actionLoading ? "Submitting..." : "Submit request"}
                </button>
              </div>
            </div>
          )}

          {activeAction === "name-change" && (
            <div className="manage-action-panel">
              <h4>Name change request</h4>
              <p>Enter the passenger name exactly as it appears on the travel document.</p>
              <input
                className="manage-action-textarea"
                style={{ minHeight: "auto" }}
                value={nameChangeValue}
                onChange={(e) => setNameChangeValue(e.target.value)}
                placeholder="New full name"
              />
              <div className="manage-action-buttons">
                <button type="button" className="flow-back-btn" onClick={() => setActiveAction(null)}>Close</button>
                <button type="button" className="flow-next-btn" onClick={handleSubmitAction} disabled={actionLoading || !nameChangeValue.trim()}>
                  {actionLoading ? "Submitting..." : "Submit request"}
                </button>
              </div>
            </div>
          )}

          {activeAction === "other-request" && (
            <div className="manage-action-panel">
              <h4>Other request</h4>
              <textarea
                className="manage-action-textarea"
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                rows={5}
                placeholder="Type your request..."
              />
              <div className="manage-action-buttons">
                <button type="button" className="flow-back-btn" onClick={() => setActiveAction(null)}>Close</button>
                <button type="button" className="flow-next-btn" onClick={handleSubmitAction} disabled={actionLoading || !requestText.trim()}>
                  {actionLoading ? "Submitting..." : "Submit request"}
                </button>
              </div>
            </div>
          )}

          {activeAction === "cancel" && (
            <div className="manage-action-panel">
              <h4>Cancel this booking</h4>
              <textarea
                className="manage-action-textarea"
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                rows={5}
                placeholder="Tell us why you are cancelling this booking"
              />
              <div className="manage-action-buttons">
                <button type="button" className="flow-back-btn" onClick={() => setActiveAction(null)}>Close</button>
                <button type="button" className="flow-next-btn" onClick={handleSubmitAction} disabled={actionLoading}>
                  {actionLoading ? "Submitting..." : "Confirm cancellation"}
                </button>
              </div>
            </div>
          )}

          {activeAction === "checkin" && (
            <div className="manage-action-panel">
              <h4>Check in for your flight</h4>
              <p>You can generate your boarding pass now.</p>
              <div className="manage-action-buttons">
                <button type="button" className="flow-back-btn" onClick={() => setActiveAction(null)}>Close</button>
                <button type="button" className="flow-next-btn" onClick={handleSubmitAction} disabled={actionLoading}>
                  {actionLoading ? "Checking in..." : "Generate boarding pass"}
                </button>
              </div>
            </div>
          )}

          {actionMessage && <div className="confirmation-banner" style={{ marginTop: "1rem" }}><p>{actionMessage}</p></div>}

          <div className="manage-history-card">
            <div className="manage-history-header">
              <h3>Request History</h3>
              <p>Track every cancellation and change request for this booking.</p>
            </div>
            {requestHistory.length === 0 ? (
              <p className="manage-history-empty">No changes have been requested for this booking yet.</p>
            ) : (
              <div className="manage-history-list">
                {requestHistory.map((entry) => (
                  <div key={entry.id} className="manage-history-item">
                    <div className="manage-history-item-top">
                      <strong>{formatRequestType(entry.requestType)}</strong>
                      <span className={`status-badge status-${entry.status?.toLowerCase() || "pending"}`}>
                        {formatRequestStatus(entry.status)}
                      </span>
                    </div>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {entry.description || "No extra notes were provided for this request."}
                    </p>
                    <span className="manage-history-date">{new Date(entry.createdAt).toLocaleString("en-GB")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {boardingPass && (
            <div className="booking-detail-card" style={{ marginTop: "1rem" }}>
              <h3>Boarding Pass</h3>
              <div className="detail-grid">
                <div><span>Reference</span><strong>{boardingPass.bookingReference}</strong></div>
                <div><span>Seat</span><strong>{boardingPass.seat}</strong></div>
                <div><span>Gate</span><strong>{boardingPass.gate}</strong></div>
                <div><span>Boarding Time</span><strong>{boardingPass.boardingTime}</strong></div>
                <div><span>Status</span><strong>{boardingPass.status}</strong></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
