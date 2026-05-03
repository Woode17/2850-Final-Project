import { useState } from "react";
import { LoadingSpinner, ErrorMessage } from "../components/StatusMessages";
import { getBookingByRef, cancelBooking, modifyBooking, requestModification, getFlights } from "../services/api";

const ADMIN_FEE = 10;
const INSURANCE_PRICE = 18;

const EXTRAS_LIST = [
  { id: "bag20",     label: "Extra 20kg hold bag", price: 35, perPerson: false, desc: null },
  { id: "bag32",     label: "Extra 32kg hold bag", price: 55, perPerson: false, desc: null },
  { id: "priority",  label: "Priority boarding",   price: 12, perPerson: false, desc: null },
  { id: "legroom",   label: "Extra legroom seat",  price: 25, perPerson: false, desc: null },
  {
    id: "insurance", label: "Travel insurance", price: INSURANCE_PRICE, perPerson: true,
    desc: "Covers emergency medical (up to £10M), trip cancellation (up to £5,000), flight delays, lost baggage, and personal liability (up to £2M). 24/7 emergency assistance included.",
  },
];

const SEAT_ROWS = Array.from({ length: 30 }, (_, i) => i + 1);
const SEAT_COLS = ["A", "B", "C", "D", "E", "F"];
const TAKEN_SEATS = new Set([
  "4A","4B","5C","6D","7A","7F","8B","8E","9C","10A",
  "11D","12B","13E","14A","15C","16F","17B","18A","19D","20C",
]);

function getSeatPrice(row, col) {
  if (row <= 6)  return col === "A" || col === "F" ? 25 : 18;
  if (row <= 10) return col === "A" || col === "F" ? 20 : 15;
  if (col === "A" || col === "F") return 15;
  if (col === "C" || col === "D") return 8;
  return 6;
}

function paxCount(booking) {
  return booking.passengers?.length || 1;
}

// ── View: Booking detail + action buttons ─────────────────
function BookingDetail({ booking, onAction }) {
  const isCancelled = booking.status?.toLowerCase() === "cancelled";
  const isCheckedIn = booking.status?.toLowerCase() === "checkedin" || booking.checkedIn;
  return (
    <div className="booking-detail-card">
      <div className="bdc-header">
        <h3>Booking Found</h3>
        <span className={`status-badge status-${(booking.status || "confirmed").toLowerCase()}`}>
          {booking.status || "Confirmed"}
        </span>
      </div>
      <div className="detail-grid">
        <div><span>Reference</span><strong>{booking.bookingReference || booking.ref || booking.id}</strong></div>
        <div><span>Passenger</span><strong>{booking.passenger?.firstName} {booking.passenger?.lastName}</strong></div>
        <div><span>Email</span><strong>{booking.passenger?.email}</strong></div>
        <div><span>Route</span><strong>{booking.flight?.from || booking.from} &rarr; {booking.flight?.to || booking.to}</strong></div>
        <div><span>Date</span><strong>{booking.flight?.departureDate || booking.departureDate || "—"}</strong></div>
        <div><span>Departure</span><strong>{booking.flight?.departureTime || "—"}</strong></div>
        <div><span>Total Paid</span><strong>£{booking.totalPrice ?? "—"}</strong></div>
      </div>

      {!isCancelled && (
        <div className="manage-actions">
          <button className="action-btn" onClick={() => onAction("modify-date")}
            disabled={isCheckedIn} title={isCheckedIn ? "Cannot modify after check-in" : ""}>
            Change Date
          </button>
          <button className="action-btn" onClick={() => onAction("extras")} disabled={isCheckedIn}>
            Add Extras / Seat
          </button>
          <button className="action-btn" onClick={() => onAction("change-name")} disabled={isCheckedIn}>
            Change Passenger Name
          </button>
          <button className="action-btn checkin-btn" onClick={() => onAction("checkin")} disabled={isCheckedIn}>
            {isCheckedIn ? "Already Checked In" : "Check In"}
          </button>
          <button className="action-btn cancel-action-btn" onClick={() => onAction("cancel")}>
            Cancel Flight
          </button>
        </div>
      )}
      {isCancelled && (
        <p className="manage-cancelled-note">This booking has been cancelled and cannot be modified.</p>
      )}
    </div>
  );
}

// ── View: Cancel confirmation ─────────────────────────────
function CancelView({ booking, onConfirm, onBack, loading }) {
  return (
    <div className="manage-action-panel">
      <h3>Cancel Flight</h3>
      <div className="cancel-warning">
        <div className="cancel-warning-icon">!</div>
        <div>
          <strong>This action cannot be undone.</strong>
          <p>You are about to cancel booking <strong>{booking.bookingReference || booking.id}</strong>:</p>
          <p>{booking.flight?.from || booking.from} &rarr; {booking.flight?.to || booking.to} on {booking.flight?.departureDate || "—"}</p>
          <p>Once cancelled, your seat will be released and cannot be recovered.</p>
          <p>Refunds are subject to your fare conditions.</p>
        </div>
      </div>
      <div className="manage-action-btns">
        <button className="flow-back-btn" onClick={onBack} disabled={loading}>Go Back</button>
        <button className="cancel-confirm-btn" onClick={onConfirm} disabled={loading}>
          {loading ? "Cancelling..." : "Yes, Cancel My Flight"}
        </button>
      </div>
    </div>
  );
}

// ── View: Extras + seat ───────────────────────────────────
function ExtrasView({ booking, onConfirm, onBack, loading }) {
  const existing  = booking.extras || [];
  const passengerCount = paxCount(booking);
  const [selectedExtras, setSelectedExtras] = useState([...existing]);
  const [selectedSeat,   setSelectedSeat]   = useState(booking.seat || null);

  function toggleExtra(id) {
    setSelectedExtras(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  }

  const extrasCost = selectedExtras.reduce((sum, id) => {
    const ex = EXTRAS_LIST.find(e => e.id === id);
    if (!ex) return sum;
    return sum + (ex.perPerson ? ex.price * passengerCount : ex.price);
  }, 0);

  const seatCost = selectedSeat && selectedSeat !== (booking.seat || "")
    ? getSeatPrice(parseInt(selectedSeat.slice(0, -1)), selectedSeat.slice(-1))
    : 0;

  const totalExtra = extrasCost + seatCost;

  return (
    <div className="manage-action-panel">
      <h3>Add Extras &amp; Choose Seat</h3>

      <h4 style={{ marginBottom: ".75rem" }}>Extras</h4>
      <div className="manage-extras-grid">
        {EXTRAS_LIST.map(extra => {
          const checked      = selectedExtras.includes(extra.id);
          const wasIncluded  = existing.includes(extra.id);
          const isInsurance  = extra.id === "insurance";
          const linePrice    = extra.perPerson ? extra.price * passengerCount : extra.price;

          return (
            <div key={extra.id}
              className={`extra-card ${checked ? "extra-card--selected" : ""} ${isInsurance ? "extra-card--insurance" : ""}`}
              onClick={() => !wasIncluded && toggleExtra(extra.id)}>
              <span className="extra-icon-label">{extra.id === "insurance" ? "Shield" : "+"}</span>
              <div className="extra-info">
                <span className="extra-label">{extra.label}</span>
                {wasIncluded ? (
                  <span className="extra-price" style={{ color: "var(--success)" }}>Already added</span>
                ) : extra.perPerson && passengerCount > 1 ? (
                  <span className="extra-price">
                    +£{extra.price}/person &nbsp;
                    <span className="extra-total">(£{linePrice} total for {passengerCount} passengers)</span>
                  </span>
                ) : (
                  <span className="extra-price">+£{linePrice}</span>
                )}
                {isInsurance && !wasIncluded && (
                  <span className="extra-per-person-note">£{extra.price} per person</span>
                )}
                {extra.desc && <p className="extra-desc">{extra.desc}</p>}
                {isInsurance && (
                  <a href="/leedsair-travel-insurance.pdf"
                    download="LeedsAir-Travel-Insurance-Policy.pdf"
                    className="insurance-download-link"
                    onClick={e => e.stopPropagation()}>
                    Download full policy document (PDF)
                  </a>
                )}
              </div>
              <div className={`extra-check ${checked ? "checked" : ""}`}>{checked ? "✓" : "+"}</div>
            </div>
          );
        })}
      </div>

      <h4 style={{ margin: "1.5rem 0 .75rem" }}>Seat Selection</h4>
      <p className="manage-seat-note">
        Current seat: <strong>{booking.seat || "Auto-assigned"}</strong>. Click a seat to change.
      </p>
      <div className="mini-seat-map">
        <div className="seat-col-headers">
          <span className="seat-row-num" />
          {SEAT_COLS.map(col => <span key={col} className="seat-col-hdr">{col}</span>)}
        </div>
        {SEAT_ROWS.map(row => (
          <div key={row} className="seat-row">
            <span className="seat-row-num">{row}</span>
            {SEAT_COLS.map(col => {
              const id    = `${row}${col}`;
              const taken = TAKEN_SEATS.has(id);
              const isSel = selectedSeat === id;
              return (
                <button key={col} type="button"
                  className={["seat seat-eco", taken ? "seat-taken" : "seat-free", isSel ? "seat-sel" : ""].filter(Boolean).join(" ")}
                  disabled={taken}
                  title={taken ? "Taken" : `${id} — +£${getSeatPrice(row, col)}`}
                  onClick={() => setSelectedSeat(isSel ? null : id)}>
                  {isSel ? "+" : col}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {totalExtra > 0 && (
        <div className="manage-cost-box">
          {extrasCost > 0 && <div className="mcb-row"><span>Extras</span><span>+£{extrasCost}</span></div>}
          {seatCost   > 0 && <div className="mcb-row"><span>Seat change ({selectedSeat})</span><span>+£{seatCost}</span></div>}
          <div className="mcb-row mcb-total"><span>Total additional cost</span><span>£{totalExtra}</span></div>
        </div>
      )}

      <div className="manage-action-btns">
        <button className="flow-back-btn" onClick={onBack} disabled={loading}>Go Back</button>
        <button className="flow-next-btn"
          onClick={() => onConfirm({ extras: selectedExtras, seat: selectedSeat })}
          disabled={loading}>
          {loading ? "Saving..." : totalExtra > 0 ? `Confirm — Pay £${totalExtra}` : "Confirm Changes"}
        </button>
      </div>
    </div>
  );
}

// ── View: Change passenger name ───────────────────────────
function ChangeNameView({ booking, onSubmit, onBack, loading }) {
  // Build list of passengers — fall back to lead passenger if no array
  const passengers = booking.passengers?.length
    ? booking.passengers
    : [booking.passenger].filter(Boolean);

  const [selectedIdx,  setSelectedIdx]  = useState(0);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName,  setNewLastName]  = useState("");
  const [reason,       setReason]       = useState("");

  const selected = passengers[selectedIdx] || {};

  return (
    <div className="manage-action-panel">
      <h3>Change Passenger Name</h3>
      <div className="name-change-notice">
        <strong>Admin approval required.</strong>
        <p>
          Name changes must be approved by a LeedsAir administrator before they take effect.
          Your request will be sent for review and you will be notified by email once processed.
        </p>
      </div>

      {/* Passenger selector — only show tabs if multiple passengers */}
      {passengers.length > 1 && (
        <div style={{ marginBottom: "1rem" }}>
          <label className="field-label">Select Passenger</label>
          <div className="pax-tabs" style={{ marginTop: ".5rem" }}>
            {passengers.map((p, i) => (
              <button key={i}
                className={`pax-tab ${i === selectedIdx ? "active" : ""}`}
                onClick={() => { setSelectedIdx(i); setNewFirstName(""); setNewLastName(""); }}>
                {p.firstName || p.lastName ? `${p.firstName} ${p.lastName}`.trim() : `Passenger ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="name-change-current">
        <span>Current name:</span>
        <strong>{selected.firstName} {selected.lastName}</strong>
      </div>

      <div className="flow-form" style={{ marginTop: "1rem" }}>
        <div className="form-row">
          <div className="form-group">
            <label>New First Name</label>
            <input value={newFirstName} onChange={e => setNewFirstName(e.target.value)}
              placeholder={selected.firstName || "First name"} />
          </div>
          <div className="form-group">
            <label>New Last Name</label>
            <input value={newLastName} onChange={e => setNewLastName(e.target.value)}
              placeholder={selected.lastName || "Last name"} />
          </div>
        </div>
        <div className="form-group">
          <label>Reason for change <span className="form-label-note">(optional)</span></label>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Spelling error on passport booking" />
        </div>
      </div>

      <div className="manage-action-btns">
        <button className="flow-back-btn" onClick={onBack} disabled={loading}>Go Back</button>
        <button className="flow-next-btn"
          disabled={(!newFirstName && !newLastName) || loading}
          onClick={() => onSubmit({
            passengerIndex: selectedIdx,
            currentName: `${selected.firstName} ${selected.lastName}`.trim(),
            newFirstName: newFirstName || selected.firstName,
            newLastName:  newLastName  || selected.lastName,
            reason,
          })}>
          {loading ? "Submitting..." : "Submit Name Change Request"}
        </button>
      </div>
    </div>
  );
}

// ── View: Modify date ─────────────────────────────────────
function ModifyDateView({ booking, onConfirm, onBack, loading }) {
  const [newDate,   setNewDate]   = useState("");
  const [flights,   setFlights]   = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [chosen,    setChosen]    = useState(null);

  const from = booking.flight?.from || booking.from || "";
  const to   = booking.flight?.to   || booking.to   || "";
  const originalPrice = booking.totalPrice || 0;

  async function handleSearch() {
    if (!newDate) return;
    setSearching(true); setSearchErr(null); setFlights(null); setChosen(null);
    try {
      const results = await getFlights({ from, to, departureDate: newDate });
      setFlights(results);
      if (!results.length) setSearchErr("No flights found on this date.");
    } catch (err) {
      setSearchErr(err.message);
    } finally {
      setSearching(false);
    }
  }

  function calcChangeCost(flightPrice) {
    return Math.max(ADMIN_FEE, (flightPrice - originalPrice) + ADMIN_FEE);
  }

  return (
    <div className="manage-action-panel">
      <h3>Change Flight Date</h3>
      <p className="manage-subtitle">
        Current booking: <strong>{from} &rarr; {to}</strong> on <strong>{booking.flight?.departureDate || "—"}</strong> (£{originalPrice} paid).
        A minimum £{ADMIN_FEE} admin fee applies to all date changes.
      </p>
      <div className="manage-date-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>New Departure Date</label>
          <input type="date" value={newDate}
            onChange={e => { setNewDate(e.target.value); setFlights(null); setChosen(null); }}
            min={new Date().toISOString().split("T")[0]} />
        </div>
        <button className="flow-next-btn" style={{ alignSelf: "flex-end" }}
          onClick={handleSearch} disabled={!newDate || searching}>
          {searching ? "Searching..." : "Find Flights"}
        </button>
      </div>

      {searchErr && <div className="form-error" style={{ marginTop: ".75rem" }}>{searchErr}</div>}

      {flights && flights.length > 0 && (
        <div className="manage-flight-list">
          <h4>Available flights on {newDate}</h4>
          {flights.map(f => {
            const changeCost = calcChangeCost(f.price);
            const isChosen   = chosen?.id === f.id;
            return (
              <div key={f.id}
                className={`manage-flight-option ${isChosen ? "manage-flight-option--selected" : ""}`}
                onClick={() => setChosen(isChosen ? null : f)}>
                <div className="mfo-times">
                  <span className="mfo-time">{f.departureTime}</span>
                  <span className="mfo-arrow">→</span>
                  <span className="mfo-time">{f.arrivalTime}</span>
                </div>
                <div className="mfo-meta">
                  <span>{f.flightNumber}</span>
                  <span>{f.duration}</span>
                  <span>{f.stops === 0 ? "Direct" : `${f.stops} stop`}</span>
                </div>
                <div className="mfo-cost">
                  <div className="mfo-change-cost">Change fee: £{changeCost}</div>
                  <div className="mfo-breakdown">
                    {f.price > originalPrice
                      ? `Price diff £${f.price - originalPrice} + £${ADMIN_FEE} admin`
                      : `£${ADMIN_FEE} admin fee (new flight is cheaper or same price)`}
                  </div>
                </div>
                <div className={`mfo-select ${isChosen ? "mfo-select--active" : ""}`}>
                  {isChosen ? "Selected" : "Select"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {chosen && (
        <div className="manage-cost-box">
          <div className="mcb-row"><span>New flight</span><span>{chosen.flightNumber} — {newDate}</span></div>
          <div className="mcb-row"><span>New flight price</span><span>£{chosen.price}</span></div>
          <div className="mcb-row"><span>Originally paid</span><span>£{originalPrice}</span></div>
          <div className="mcb-row mcb-total">
            <span>Change fee (inc. £{ADMIN_FEE} admin)</span>
            <span>£{calcChangeCost(chosen.price)}</span>
          </div>
        </div>
      )}

      {chosen && (
        <div className="name-change-notice" style={{marginTop:"1rem"}}>
          <strong>Admin approval required</strong>
          <p>
            Your booking will remain on the original date until a LeedsAir administrator approves this request.
            Your booking status will show as <strong>Pending</strong> while the request is under review.
            The change fee of <strong>£{calcChangeCost(chosen.price)}</strong> will be charged upon approval.
          </p>
        </div>
      )}

      <div className="manage-action-btns">
        <button className="flow-back-btn" onClick={onBack} disabled={loading}>Go Back</button>
        <button className="flow-next-btn"
          onClick={() => onConfirm({ flight: chosen, changeCost: calcChangeCost(chosen.price), newDate })}
          disabled={!chosen || loading}>
          {loading ? "Saving..." : chosen ? `Confirm Change — Pay £${calcChangeCost(chosen.price)}` : "Select a flight first"}
        </button>
      </div>
    </div>
  );
}

// ── Main ManageBookingPage ────────────────────────────────
export function ManageBookingPage({ onNavigate }) {
  const [ref,      setRef]      = useState("");
  const [lastName, setLastName] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [booking,  setBooking]  = useState(null);
  const [view,     setView]     = useState("detail");
  const [actionLoading, setActionLoading] = useState(false);
  const [successMsg,    setSuccessMsg]    = useState(null);

  async function handleLookup(e) {
    e.preventDefault();
    setLoading(true); setError(null); setBooking(null);
    setView("detail"); setSuccessMsg(null);
    try {
      const data  = await getBookingByRef(ref, lastName);
      const found = Array.isArray(data) ? data[0] : data;
      if (!found) throw new Error("Booking not found.");
      setBooking(found);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setActionLoading(true);
    try {
      await cancelBooking(booking.id);
      setBooking(prev => ({ ...prev, status: "Cancelled" }));
      setView("detail");
      setSuccessMsg("Your booking has been cancelled.");
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleExtras({ extras, seat }) {
    setActionLoading(true);
    try {
      // Extras and seat changes apply immediately — no approval needed
      await modifyBooking(booking.id, { extras, ...(seat ? { seat } : {}) });
      setBooking(prev => ({ ...prev, extras, seat: seat || prev.seat }));
      setView("detail");
      setSuccessMsg("Your extras and seat have been updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleNameChange({ passengerIndex, currentName, newFirstName, newLastName, reason }) {
    setActionLoading(true);
    try {
      // Name changes require admin approval — submitted as a modification request
      await requestModification(booking.id, {
        requestType: "name_change",
        description: `Name change for passenger ${passengerIndex + 1}. Current: "${currentName}" -> Requested: "${newFirstName} ${newLastName}". Reason: ${reason || "Not provided"}.`,
        newFirstName,
        newLastName,
        passengerIndex,
        modificationRequested: "name_change",
        modificationDescription: `Name change: ${currentName} -> ${newFirstName} ${newLastName}`,
      });
      // Update local state to show Pending
      setBooking(prev => ({ ...prev, status: "Pending" }));
      setView("detail");
      setSuccessMsg(
        "Name change request submitted and is awaiting admin approval. Your booking status will show as Pending until approved."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleModifyDate({ flight, changeCost, newDate }) {
    setActionLoading(true);
    try {
      // Date changes require admin approval — submitted as a modification request
      await requestModification(booking.id, {
        requestType: "date_change",
        description: `Date change to ${newDate}, flight ${flight.flightNumber}. Change fee: £${changeCost}`,
        newDate,
        newFlightNumber: flight.flightNumber,
        changeCost,
        modificationRequested: "date_change",
        modificationDescription: `Date change to ${newDate} (£${changeCost} fee)`,
        modificationRequestedAt: new Date().toISOString(),
      });
      // Show booking as Pending — date does NOT change until admin approves
      setBooking(prev => ({ ...prev, status: "Pending" }));
      setView("detail");
      setSuccessMsg(
        `Date change request submitted for ${newDate} (£${changeCost} change fee). ` +
        `Your booking will remain on the original date until an administrator approves the change. ` +
        `Your booking status now shows as Pending.`
      );
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
          <label htmlFor="manage-ref">Booking Reference</label>
          <input id="manage-ref" placeholder="e.g. LEEDSABC1" value={ref}
            onChange={e => setRef(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="manage-lastname">Last Name</label>
          <input id="manage-lastname" placeholder="Passenger surname" value={lastName}
            onChange={e => setLastName(e.target.value)} required />
        </div>
        <button type="submit" className="search-btn" disabled={loading}>
          {loading ? "Searching..." : "Find My Booking"}
        </button>
      </form>

      {loading  && <LoadingSpinner message="Looking up booking..." />}
      {error    && <ErrorMessage message={error} />}

      {successMsg && (
        <div className="confirmation-banner" style={{ margin: "1rem 0" }}>
          <span className="confirm-icon">+</span>
          <p>{successMsg}</p>
          <button className="dismiss-btn" onClick={() => setSuccessMsg(null)}>x</button>
        </div>
      )}

      {booking && view === "detail"      && <BookingDetail booking={booking} onAction={action => {
        if (action === "checkin") { onNavigate("checkin"); return; }
        setView(action); setError(null);
      }} />}
      {booking && view === "cancel"      && <CancelView      booking={booking} loading={actionLoading} onBack={() => setView("detail")} onConfirm={handleCancel} />}
      {booking && view === "extras"      && <ExtrasView      booking={booking} loading={actionLoading} onBack={() => setView("detail")} onConfirm={handleExtras} />}
      {booking && view === "change-name" && <ChangeNameView  booking={booking} loading={actionLoading} onBack={() => setView("detail")} onSubmit={handleNameChange} />}
      {booking && view === "modify-date" && <ModifyDateView  booking={booking} loading={actionLoading} onBack={() => setView("detail")} onConfirm={handleModifyDate} />}
    </div>
  );
}