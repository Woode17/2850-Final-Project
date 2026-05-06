import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { createBooking, login, register } from "../services/api";
import { RouteMap } from "../components/RouteMap";



const MAX_PASSENGERS = 7;
const SAVED_CARD_STORAGE_KEY = "leedsair_saved_card";
const INSURANCE_PDF = "/LeedsAir-Travel-Insurance-Policy.pdf";

const FLOW_STEPS = ["Flight summary", "Passenger details", "Seats", "Extras", "Review & Pay"];

function detectCardBrand(cardNumber) {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "American Express";
  if (digits.startsWith("6")) return "Discover";
  return digits ? "Card" : "";
}

function isValidCardNumber(cardNumber) {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 12) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function isValidExpiry(expiryValue) {
  const [monthRaw, yearRaw] = expiryValue.split("/").map((part) => part.trim());
  const month = Number(monthRaw);
  const year = Number(yearRaw?.length === 2 ? `20${yearRaw}` : yearRaw);
  if (!Number.isFinite(month) || !Number.isFinite(year) || month < 1 || month > 12) return false;
  const now = new Date();
  const expiryDate = new Date(year, month, 0, 23, 59, 59);
  return expiryDate >= now;
}

function isValidCvv(cvv, cardNumber) {
  const digits = cvv.replace(/\D/g, "");
  const brand = detectCardBrand(cardNumber);
  return brand === "American Express" ? digits.length === 4 : digits.length === 3;
}

function estimateLoyaltyPoints(total, travelClass, includeFirstBookingBonus) {
  const multiplier = travelClass === "business" ? 2 : 1;
  const basePoints = Math.max(0, Math.floor(total)) * multiplier;
  return basePoints + (includeFirstBookingBonus ? 500 : 0);
}

function getSavedCard() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SAVED_CARD_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.last4 || !parsed?.maskedNumber || !parsed?.cardholderName || !parsed?.expiryDisplay) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveCardSummary(cardNumber, cardholderName, expiryMonth, expiryYear) {
  if (typeof window === "undefined") return;

  const digits = cardNumber.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  const normalizedMonth = String(expiryMonth).padStart(2, "0");
  const shortYear = String(expiryYear).slice(-2);

  window.localStorage.setItem(SAVED_CARD_STORAGE_KEY, JSON.stringify({
    last4,
    maskedNumber: `**** **** **** ${last4}`,
    cardholderName: cardholderName.trim(),
    expiryDisplay: `${normalizedMonth}/${shortYear}`,
  }));
}

function clearSavedCard() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SAVED_CARD_STORAGE_KEY);
}

function FlowStepper({ step }) {
  return (
    <div className="flow-stepper">
      {FLOW_STEPS.map((label, i) => (
        <div key={label} className={`flow-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
          <div className="flow-circle">{i < step ? "✓" : i + 1}</div>
          <span className="flow-label">{label}</span>
          {i < FLOW_STEPS.length - 1 && <div className="flow-line" />}
        </div>
      ))}
    </div>
  );
}

function getSeatPrice(row, col, isBiz) {
  if (isBiz) {
    if (row === 1) return col === "A" || col === "F" ? 55 : 45;
    if (row === 2) return col === "A" || col === "F" ? 45 : 35;
    return 30;
  }
  if (row <= 6)  return col === "A" || col === "F" ? 25 : 18;
  if (row <= 10) return col === "A" || col === "F" ? 20 : 15;
  if (col === "A" || col === "F") return 15;
  if (col === "C" || col === "D") return 8;
  return 6;
}

const BASE_TAKEN = new Set([
  "4A","4B","5C","6D","7A","7F","8B","8E","9C","10A",
  "11D","12B","13E","14A","15C","16F","17B","18A","19D","20C","1B","2D","3A"
]);
const ROWS_BIZ = [1, 2, 3];
const ROWS_ECO = Array.from({ length: 27 }, (_, i) => i + 4);
const COLS     = ["A", "B", "C", "", "D", "E", "F"];

function SeatMap({ selected, onSelect, travelClass, chosenByOthers = [] }) {
  const isBizBooking = travelClass === "business";
  const takenOrChosen = new Set([...BASE_TAKEN, ...chosenByOthers]);

  function renderSeat(row, col) {
    if (!col) return <div key={`aisle-${row}`} className="seat-aisle" />;
    const id      = `${row}${col}`;
    const isBiz   = row <= 3;
    const isTaken = takenOrChosen.has(id);
    const isLocked= isBizBooking ? !isBiz : isBiz;
    const price   = getSeatPrice(row, col, isBiz);
    const isSel   = selected === id;
    let tier = "";
    if (!isBiz) {
      if (row <= 6) tier = "seat-front";
      else if (col === "A" || col === "F") tier = "seat-window";
      else if (col === "C" || col === "D") tier = "seat-aisle-seat";
    }
    return (
      <button key={id} type="button" disabled={isTaken || isLocked}
        className={["seat", isBiz ? "seat-biz" : "seat-eco",
          isTaken ? "seat-taken" : isLocked ? "seat-locked" : "seat-free",
          tier, isSel ? "seat-sel" : ""].filter(Boolean).join(" ")}
        title={isLocked ? "Not your ticket class" : isTaken ? "Already taken" : `${id} — +£${price}`}
        onClick={() => !isTaken && !isLocked && onSelect(isSel ? null : id)}>
        {isSel ? "✓" : col}
      </button>
    );
  }

  return (
    <div className="seat-map-wrap">
      <div className="seat-legend seat-legend--top">
        {isBizBooking ? (<>
          <span className="legend-item"><span className="seat seat-free seat-biz legend-demo" />Row 1 window £55</span>
          <span className="legend-item"><span className="seat seat-free seat-biz legend-demo" />Row 2 £35–45</span>
          <span className="legend-item"><span className="seat seat-free seat-biz legend-demo" />Row 3 £30</span>
        </>) : (<>
          <span className="legend-item"><span className="seat seat-free seat-front legend-demo" />Front £18–25</span>
          <span className="legend-item"><span className="seat seat-free seat-window legend-demo" />Window £15</span>
          <span className="legend-item"><span className="seat seat-free seat-aisle-seat legend-demo" />Aisle £8</span>
          <span className="legend-item"><span className="seat seat-free seat-eco legend-demo" />Middle £6</span>
        </>)}
        <span className="legend-item"><span className="seat seat-taken legend-demo" />Taken</span>
        <span className="legend-item"><span className="seat seat-locked legend-demo" />Not your class</span>
        {chosenByOthers.length > 0 && (
          <span className="legend-item"><span className="seat seat-taken legend-demo" style={{background:"#a78bfa"}} />Your group</span>
        )}
      </div>
      <div className="seat-map">
        <div className="seat-col-headers">
          <span className="seat-row-num" />
          {COLS.map((col, i) => col ? <span key={i} className="seat-col-hdr">{col}</span> : <span key={i} className="seat-aisle" />)}
        </div>
        <div className={`cabin-label cabin-biz-label ${!isBizBooking ? "cabin-locked-label" : ""}`}>
          ✦ Business Class {!isBizBooking && "— Economy ticket only"}
        </div>
        {ROWS_BIZ.map(row => (
          <div key={row} className="seat-row">
            <span className="seat-row-num">{row}</span>
            {COLS.map((col, ci) => renderSeat(row, col))}
          </div>
        ))}
        <div className="cabin-divider"><span>Economy Class {isBizBooking && "— Business ticket only"}</span></div>
        {ROWS_ECO.map(row => (
          <div key={row} className="seat-row">
            <span className="seat-row-num">{row}</span>
            {COLS.map((col, ci) => renderSeat(row, col))}
          </div>
        ))}
      </div>
    </div>
  );
}

const EXTRAS_LIST = [
  { id: "bag20",     label: "Extra 20kg hold bag",  price: 35, icon: "🧳" },
  { id: "bag32",     label: "Extra 32kg hold bag",  price: 55, icon: "🧳" },
  { id: "priority",  label: "Priority boarding",     price: 12, icon: "⚡" },
  { id: "legroom",   label: "Extra legroom seat",   price: 25, icon: "💺" },
  { id: "insurance", label: "Travel insurance",     price: 18, icon: "🛡"  },
];

function AuthPanel({ onAuthComplete }) {
  const { loginUser } = useAuth();
  const [mode,      setMode]      = useState("login");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  async function handleLogin(e) {
    e.preventDefault(); setLoading(true); setError(null);
    try { const d = await login(email, password); loginUser(d.token, d.user); onAuthComplete(d.user); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  async function handleRegister(e) {
    e.preventDefault(); setLoading(true); setError(null);
    try { const d = await register({ firstName, lastName, email, password }); loginUser(d.token, d.user); onAuthComplete(d.user); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <div className="auth-panel">
      <div className="auth-panel-header">
        <span className="auth-panel-icon">🎁</span>
        <div>
          <h3>Save booking &amp; earn rewards</h3>
          <p>Log in or create a free account to earn loyalty points on this booking.</p>
        </div>
      </div>
      <div className="auth-panel-tabs">
        <button className={`auth-tab ${mode==="login"    ?"active":""}`} onClick={()=>setMode("login")}>Log in</button>
        <button className={`auth-tab ${mode==="register" ?"active":""}`} onClick={()=>setMode("register")}>Create account</button>
        <button className="auth-tab auth-tab-skip" onClick={()=>onAuthComplete(null)}>Continue as guest</button>
      </div>
      {error && <div className="form-error" style={{margin:"0 0 .75rem"}}>⚠ {error}</div>}
      {mode === "login" ? (
        <form onSubmit={handleLogin} className="auth-mini-form">
          <div className="form-group"><label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" required /></div>
          <div className="form-group"><label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required /></div>
          <button className="flow-next-btn" style={{width:"100%",marginTop:".5rem"}} disabled={loading}>
            {loading?"Logging in…":"Log in & continue"}</button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="auth-mini-form">
          <div className="form-row">
            <div className="form-group"><label>First name</label>
              <input value={firstName} onChange={e=>setFirstName(e.target.value)} required placeholder="Jane" /></div>
            <div className="form-group"><label>Last name</label>
              <input value={lastName} onChange={e=>setLastName(e.target.value)} required placeholder="Smith" /></div>
          </div>
          <div className="form-group"><label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" required /></div>
          <div className="form-group"><label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required /></div>
          <button className="flow-next-btn" style={{width:"100%",marginTop:".5rem"}} disabled={loading}>
            {loading?"Creating account…":"Create account & continue"}</button>
        </form>
      )}
    </div>
  );
}

function buildPassengers(flight, user) {
  const adults   = Math.max(1, Number(flight?.searchParams?.adults)   || 1);
  const children =              Number(flight?.searchParams?.children) || 0;
  const infants  =              Number(flight?.searchParams?.infants)  || 0;
  const total    = Math.min(adults + children + infants, MAX_PASSENGERS);
  return Array.from({ length: total }, (_, i) => {
    const isAdult   = i < adults;
    const isChild   = i >= adults && i < adults + children;
    const type      = isAdult ? "adult" : isChild ? "child" : "infant";
    return {
      firstName:      i === 0 && user?.firstName ? user.firstName : "",
      lastName:       i === 0 && user?.lastName  ? user.lastName  : "",
      dateOfBirth:    "",
      passportNumber: "",
      email:          i === 0 && user?.email     ? user.email     : "",
      phone:          i === 0 && user?.phone     ? user.phone     : "",
      type,
    };
  });
}

function paxLabel(pax, idx) {
  const typeLabel = pax.type === "adult" ? "Adult" : pax.type === "child" ? "Child" : "Infant";
  const name = pax.firstName || pax.lastName ? `${pax.firstName} ${pax.lastName}`.trim() : null;
  return name ? `${typeLabel} ${idx+1}: ${name}` : `${typeLabel} ${idx+1}`;
}

export function BookingFlowPage({ flight, onNavigate, onComplete }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  if (!flight) {
    return (
      <div className="page booking-flow-page">
        <div className="page-header">
          <h1>Booking</h1>
          <p>Select a flight before continuing to passenger details and payment.</p>
        </div>
        <div className="empty-state">
          <span className="empty-icon">✈</span>
          <p>Your booking selection could not be loaded.</p>
          <button className="search-btn" onClick={() => onNavigate("home")}>Back to search</button>
        </div>
      </div>
    );
  }

  const [passengers, setPassengers] = useState(() => buildPassengers(flight, user));
  const [paxIdx,     setPaxIdx]     = useState(0); // which passenger we're editing
  const [seats,      setSeats]      = useState([]); // seats[i] = seatId or null
  const [seatPaxIdx, setSeatPaxIdx] = useState(0); // which passenger we're picking seat for

  const paxCount = passengers.length;

  function setPaxField(idx, field, value) {
    setPassengers(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  const [extras,     setExtras]     = useState([]);
  const [agreed,     setAgreed]     = useState(false);
  const [authDone,   setAuthDone]   = useState(!!user);
  const [cardNum,    setCardNum]    = useState("");
  const [cardExp,    setCardExp]    = useState("");
  const [cardCvv,    setCardCvv]    = useState("");
  const [cardName,   setCardName]   = useState("");
  const [savedCard,  setSavedCard]  = useState(() => getSavedCard());
  const [useSavedCard, setUseSavedCard] = useState(() => Boolean(getSavedCard()));
  const [rememberCard, setRememberCard] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState(null);

  const isBiz      = flight?.travelClass === "business";
  const pricePerPax = flight?.totalPrice || flight?.price || 0;
  const baseFareTotal = pricePerPax * paxCount;
  const seatCostTotal = seats.reduce((sum, seatId) => {
    if (!seatId) return sum;
    const row = parseInt(seatId.slice(0, -1));
    const col = seatId.slice(-1);
    return sum + getSeatPrice(row, col, isBiz);
  }, 0);
  const extrasCost = extras.reduce((s, id) => s + (EXTRAS_LIST.find(e => e.id === id)?.price || 0), 0);
  const total = baseFareTotal + seatCostTotal + extrasCost;
  const activeCardNumber = useSavedCard && savedCard ? savedCard.maskedNumber : cardNum;
  const activeCardName = useSavedCard && savedCard ? savedCard.cardholderName : cardName;
  const activeCardExpiry = useSavedCard && savedCard ? savedCard.expiryDisplay : cardExp;
  const cardBrand = useSavedCard && savedCard ? "Saved card" : detectCardBrand(activeCardNumber);
  const cardNumberValid = useSavedCard && savedCard ? true : isValidCardNumber(activeCardNumber);
  const expiryValid = useSavedCard && savedCard ? true : isValidExpiry(activeCardExpiry);
  const cvvValid = isValidCvv(cardCvv, activeCardNumber);
  const paymentReady = activeCardName.trim() && cardNumberValid && expiryValid && cvvValid;

  function toggleExtra(id) {
    setExtras(p => p.includes(id) ? p.filter(e => e !== id) : [...p, id]);
  }

  function handleAuthComplete(u) {
    if (u) {
      setPassengers(prev => prev.map((p, i) => i === 0 ? {
        ...p,
        firstName: p.firstName || u.firstName || "",
        lastName:  p.lastName  || u.lastName  || "",
        email:     p.email     || u.email     || "",
        phone:     p.phone     || u.phone     || "",
      } : p));
    }
    setAuthDone(true);
  }

  async function handlePay() {
    setSubmitting(true); setSubmitErr(null);
    try {
      const expiryParts = activeCardExpiry.split("/").map(part => part.trim());
      const expiryMonth = Number(expiryParts[0]);
      const expiryYear = expiryParts[1]
        ? Number(expiryParts[1].length === 2 ? `20${expiryParts[1]}` : expiryParts[1])
        : NaN;

      if (!paymentReady || !Number.isFinite(expiryMonth) || !Number.isFinite(expiryYear)) {
        setSubmitErr("Check your card number, expiry date, cardholder name, and CVV before confirming payment.");
        setSubmitting(false);
        return;
      }

      const booking = await createBooking({
        userId: user?.id ?? null,
        flightId: String(flight.id), travelClass: flight.travelClass,
        seats, extras, totalPrice: total, passengers,
        // legacy single-passenger field for server compat
        passenger: passengers[0],
        payment: {
          cardholderName: activeCardName,
          cardNumber: activeCardNumber,
          expiryMonth,
          expiryYear,
          cvv: cardCvv,
          billingPostalCode: "",
        },
      });

      if (!useSavedCard && rememberCard) {
        saveCardSummary(activeCardNumber, activeCardName, expiryMonth, expiryYear);
        const latestSavedCard = getSavedCard();
        setSavedCard(latestSavedCard);
        setUseSavedCard(Boolean(latestSavedCard));
      }

      onComplete(booking);
    } catch (err) { setSubmitErr(err.message); }
    finally { setSubmitting(false); }
  }


  function paxValid(p, i) {
    return p.firstName && p.lastName && p.passportNumber && (i > 0 || p.email);
  }
  const allPaxValid = passengers.every((p, i) => paxValid(p, i));

  if (step === 0) return (
    <div className="booking-flow-page">
      <div className="booking-flow-stepper-bar"><FlowStepper step={0} /></div>
      <div className="booking-flow-body"><div className="flow-step-body">
        <h2 className="flow-step-title">Flight Summary</h2>

        {/* Outbound */}
        <div className="flow-summary-card">
          <div className="fsc-header">
            <span className="fsc-type">Outbound</span>
            <span className={`fsc-class ${isBiz?"biz":""}`}>{isBiz?"✦ Business":"Economy"} · {flight.selectedFare?.label}</span>
          </div>
          <div className="fsc-route">
            <div className="fsc-point"><span className="fsc-code">{flight.from}</span><span className="fsc-time">{flight.departureTime}</span></div>
            <div className="fsc-middle">
              <span className="fsc-dur">{flight.duration}</span>
              <div className="fsc-line-wrap"><div className="fsc-line" /></div>
              <span className="fsc-stops">{flight.stops===0?"Direct":`${flight.stops} stop`}</span>
            </div>
            <div className="fsc-point fsc-point--right"><span className="fsc-code">{flight.to}</span><span className="fsc-time">{flight.arrivalTime}</span></div>
          </div>
          <div className="fsc-meta"><span>✈ {flight.airline} · {flight.flightNumber}</span><span>{flight.departureDate}</span></div>
        </div>

        {/* Return (if round-trip) */}
        {flight.returnFlight && (
          <div className="flow-summary-card" style={{marginTop:"1rem"}}>
            <div className="fsc-header">
              <span className="fsc-type">Return</span>
              <span className={`fsc-class ${flight.returnFlight.travelClass==="business"?"biz":""}`}>
                {flight.returnFlight.travelClass==="business"?"✦ Business":"Economy"} · {flight.returnFlight.selectedFare?.label}
              </span>
            </div>
            <div className="fsc-route">
              <div className="fsc-point"><span className="fsc-code">{flight.returnFlight.from}</span><span className="fsc-time">{flight.returnFlight.departureTime}</span></div>
              <div className="fsc-middle">
                <span className="fsc-dur">{flight.returnFlight.duration}</span>
                <div className="fsc-line-wrap"><div className="fsc-line" /></div>
                <span className="fsc-stops">{flight.returnFlight.stops===0?"Direct":`${flight.returnFlight.stops} stop`}</span>
              </div>
              <div className="fsc-point fsc-point--right"><span className="fsc-code">{flight.returnFlight.to}</span><span className="fsc-time">{flight.returnFlight.arrivalTime}</span></div>
            </div>
            <div className="fsc-meta"><span>✈ {flight.returnFlight.airline} · {flight.returnFlight.flightNumber}</span><span>{flight.returnFlight.departureDate}</span></div>
          </div>
        )}

        {/* Price breakdown per passenger */}
        <div className="flow-price-box">
          <div className="fpb-row"><span>Fare per passenger</span><span>£{pricePerPax}</span></div>
          <div className="fpb-row fpb-muted"><span>× {paxCount} passenger{paxCount>1?"s":""}</span><span>£{baseFareTotal}</span></div>
          <div className="fpb-row fpb-muted"><span>Taxes &amp; fees</span><span>Included</span></div>
          <div className="fpb-row fpb-total"><span>Total so far</span><span>£{total}</span></div>
        </div>
        <div className="flow-fare-features">
          <h3>What's included</h3>
          <ul>
            <li>🧳 {flight.selectedFare?.baggage}</li>
            <li>✏️ {flight.selectedFare?.changes}</li>
            <li>💰 {flight.selectedFare?.refund}</li>
          </ul>
        </div>
        <div className="flow-actions">
          <button className="flow-back-btn" onClick={()=>onNavigate("results")}>← Modify selection</button>
          <button className="flow-next-btn" onClick={()=>setStep(1)}>Continue →</button>
        </div>
      </div></div>
    </div>
  );

  
  if (step === 1) {
    const p   = passengers[paxIdx];
    const isFirst = paxIdx === 0;
    const thisValid = paxValid(p, paxIdx);

    return (
      <div className="booking-flow-page">
        <div className="booking-flow-stepper-bar"><FlowStepper step={1} /></div>
        <div className="booking-flow-body"><div className="flow-step-body">
          <h2 className="flow-step-title">Passenger Details</h2>

          {/* Passenger tabs */}
          {paxCount > 1 && (
            <div className="pax-tabs">
              {passengers.map((px, i) => (
                <button key={i}
                  className={`pax-tab ${i===paxIdx?"active":""} ${paxValid(px,i)?"pax-tab--done":""}`}
                  onClick={()=>setPaxIdx(i)}>
                  {paxValid(px,i) ? "✓ " : ""}{paxLabel(px, i)}
                </button>
              ))}
            </div>
          )}

          <div className="pax-tab-header">
            <h3 className="pax-tab-name">{paxLabel(p, paxIdx)}</h3>
            <span className="pax-tab-type">{p.type === "infant" ? "Under 2" : p.type === "child" ? "Age 2–15" : "Age 16+"}</span>
          </div>

          {isFirst && user && <p className="flow-autofill-note">✓ Lead passenger auto-filled from your account</p>}

          {/* Inputs — stable because they use stable setState from top-level array */}
          <div className="flow-form">
            <div className="form-row">
              <div className="form-group">
                <label>First Name *</label>
                <input value={p.firstName} onChange={e=>setPaxField(paxIdx,"firstName",e.target.value)} placeholder="Jane" />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input value={p.lastName} onChange={e=>setPaxField(paxIdx,"lastName",e.target.value)} placeholder="Smith" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date of Birth</label>
                <input type="date" value={p.dateOfBirth} onChange={e=>setPaxField(paxIdx,"dateOfBirth",e.target.value)} />
              </div>
              <div className="form-group">
                <label>Passport / ID Number *</label>
                <input value={p.passportNumber} onChange={e=>setPaxField(paxIdx,"passportNumber",e.target.value)} placeholder="GB123456789" />
              </div>
            </div>
            {isFirst && (
              <div className="form-row">
                <div className="form-group">
                  <label>Email * <span className="form-label-note">(lead passenger)</span></label>
                  <input type="email" value={p.email} onChange={e=>setPaxField(paxIdx,"email",e.target.value)} placeholder="your@email.com" />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={p.phone} onChange={e=>setPaxField(paxIdx,"phone",e.target.value)} placeholder="+44 7700 000000" />
                </div>
              </div>
            )}
          </div>

          {/* Nav between passengers */}
          <div className="flow-actions">
            <button className="flow-back-btn" onClick={()=>{ if(paxIdx>0) setPaxIdx(paxIdx-1); else setStep(0); }}>← Back</button>
            {paxIdx < paxCount - 1 ? (
              <button className="flow-next-btn" onClick={()=>setPaxIdx(paxIdx+1)} disabled={!thisValid}>
                Next passenger →
              </button>
            ) : (
              <button className="flow-next-btn" onClick={()=>{ setSeatPaxIdx(0); setStep(2); }} disabled={!allPaxValid}>
                Continue to seats →
              </button>
            )}
          </div>
        </div></div>
      </div>
    );
  }

  if (step === 2) {
    const currentSeat = seats[seatPaxIdx] ?? null;
    const chosenByOthers = seats.filter((s, i) => s && i !== seatPaxIdx);
    const pax = passengers[seatPaxIdx];

    function setCurrentSeat(seatId) {
      setSeats(prev => {
        const next = [...prev];
        next[seatPaxIdx] = seatId;
        return next;
      });
    }

    function goNextSeat() {
      if (seatPaxIdx < paxCount - 1) setSeatPaxIdx(seatPaxIdx + 1);
      else setStep(3);
    }

    return (
      <div className="booking-flow-page">
        <div className="booking-flow-stepper-bar"><FlowStepper step={2} /></div>
        <div className="booking-flow-body"><div className="flow-step-body">
          <h2 className="flow-step-title">Choose Your Seat</h2>

          {/* Seat progress tabs */}
          {paxCount > 1 && (
            <div className="pax-tabs">
              {passengers.map((px, i) => (
                <button key={i}
                  className={`pax-tab ${i===seatPaxIdx?"active":""} ${seats[i]?"pax-tab--done":""}`}
                  onClick={()=>setSeatPaxIdx(i)}>
                  {seats[i] ? `✓ ${seats[i]}` : paxLabel(px, i)}
                </button>
              ))}
            </div>
          )}

          <div className="pax-tab-header">
            <h3 className="pax-tab-name">Seat for {paxLabel(pax, seatPaxIdx)}</h3>
            <span className="pax-tab-type">{isBiz ? "✦ Business" : "Economy"} class only</span>
          </div>

          {currentSeat && (
            <p className="flow-seat-chosen">
              ✓ Seat <strong>{currentSeat}</strong> selected — +£{getSeatPrice(parseInt(currentSeat.slice(0,-1)), currentSeat.slice(-1), isBiz)}
            </p>
          )}

          <SeatMap
            selected={currentSeat}
            onSelect={setCurrentSeat}
            travelClass={flight.travelClass}
            chosenByOthers={chosenByOthers}
          />

          <div className="flow-actions">
            <button className="flow-back-btn" onClick={()=>{ if(seatPaxIdx>0) setSeatPaxIdx(seatPaxIdx-1); else setStep(1); }}>← Back</button>
            <button className="flow-skip-btn" onClick={()=>{ setCurrentSeat(null); goNextSeat(); }}>Skip this passenger</button>
            <button className="flow-next-btn" onClick={goNextSeat}>
              {seatPaxIdx < paxCount - 1 ? "Next passenger →" : "Continue →"}
            </button>
          </div>
        </div></div>
      </div>
    );
  }

  if (step === 3) return (
    <div className="booking-flow-page">
      <div className="booking-flow-stepper-bar"><FlowStepper step={3} /></div>
      <div className="booking-flow-body"><div className="flow-step-body">
        <h2 className="flow-step-title">Add Extras</h2>
        <p className="flow-subtitle">Enhance your journey. Extras apply to the whole booking.</p>
        <div className="extras-grid">
          {EXTRAS_LIST.map(extra => {
            const checked = extras.includes(extra.id);
            return (
              <div key={extra.id} className={`extra-card ${checked?"extra-card--selected":""}`} onClick={()=>toggleExtra(extra.id)}>
                <span className="extra-icon">{extra.icon}</span>
                <div className="extra-info">
                  <span className="extra-label">{extra.label}</span>
                  <span className="extra-price">+£{extra.price}</span>
                  {extra.id === "insurance" && (
                    <small>
                      Covers cancellation, delays and lost baggage.{" "}
                      <a href={INSURANCE_PDF} target="_blank" rel="noreferrer">View policy PDF</a>{" · "}
                      <a href={INSURANCE_PDF} download>Download PDF</a>
                    </small>
                  )}
                </div>
                <div className={`extra-check ${checked?"checked":""}`}>{checked?"✓":"+"}</div>
              </div>
            );
          })}
        </div>
        <div className="flow-running-total">Running total: <strong>£{total}</strong></div>
        <div className="flow-actions">
          <button className="flow-back-btn" onClick={()=>{ setSeatPaxIdx(paxCount-1); setStep(2); }}>← Back</button>
          <button className="flow-next-btn" onClick={()=>setStep(4)}>Continue →</button>
        </div>
      </div></div>
    </div>
  );

  return (
    <div className="booking-flow-page">
      <div className="booking-flow-stepper-bar"><FlowStepper step={4} /></div>
      <div className="booking-flow-body"><div className="flow-step-body">
        <h2 className="flow-step-title">Review &amp; Pay</h2>

        {!authDone && <AuthPanel onAuthComplete={handleAuthComplete} />}
        {!authDone && (
          <div className="flow-actions" style={{marginTop:"1rem"}}>
            <button className="flow-back-btn" onClick={()=>setStep(3)}>← Back</button>
          </div>
        )}
        {authDone && user && (
          <div className="auth-success-banner">
            🎉 Logged in as <strong>{user.firstName} {user.lastName}</strong> — booking saved &amp; you'll earn <strong>{estimateLoyaltyPoints(total, flight.travelClass, (user.loyaltyPoints ?? 0) === 0)} loyalty points</strong>!
          </div>
        )}

        {authDone && (<>
          {/* Flight */}
          <div className="review-section">
            <h3>Flight</h3>
            <RouteMap
              from={flight.from}
              to={flight.to}
              stops={flight.stops ?? 0}
              departureTime={flight.departureTime}
              arrivalTime={flight.arrivalTime}
              flightNumber={flight.flightNumber}
              compact
              caption="Outbound route"
            />
            <div className="review-row"><span>Route</span><span>{flight.from} → {flight.to}</span></div>
            <div className="review-row"><span>Flight</span><span>{flight.flightNumber}</span></div>
            <div className="review-row"><span>Departure</span><span>{flight.departureDate} · {flight.departureTime}</span></div>
            <div className="review-row"><span>Class</span><span>{isBiz?"✦ Business":"Economy"} · {flight.selectedFare?.label}</span></div>
            {flight.returnFlight && <>
              <RouteMap
                from={flight.returnFlight.from}
                to={flight.returnFlight.to}
                stops={flight.returnFlight.stops ?? 0}
                departureTime={flight.returnFlight.departureTime}
                arrivalTime={flight.returnFlight.arrivalTime}
                flightNumber={flight.returnFlight.flightNumber}
                compact
                caption="Return route"
              />
              <div className="review-row"><span>Return flight</span><span>{flight.returnFlight.flightNumber}</span></div>
              <div className="review-row"><span>Return</span><span>{flight.returnFlight.departureDate} · {flight.returnFlight.departureTime}</span></div>
            </>}
          </div>

          {/* Passengers */}
          <div className="review-section">
            <h3>{paxCount > 1 ? `Passengers (${paxCount})` : "Passenger"}</h3>
            {passengers.map((p, i) => (
              <div key={i} className="review-pax-row">
                <div className="review-pax-name">
                  <strong>{paxLabel(p, i)}</strong>
                  {seats[i] && <span className="review-pax-seat"> · Seat {seats[i]} (+£{getSeatPrice(parseInt(seats[i].slice(0,-1)), seats[i].slice(-1), isBiz)})</span>}
                  {!seats[i] && <span className="review-pax-seat review-pax-no-seat"> · Seat auto-assigned</span>}
                </div>
                <div className="review-pax-details">
                  <span>{p.firstName} {p.lastName}</span>
                  {p.passportNumber && <span> · {p.passportNumber}</span>}
                  {p.email && <span> · {p.email}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Extras */}
          {extras.length > 0 && (
            <div className="review-section">
              <h3>Extras</h3>
              {extras.map(id => { const ex=EXTRAS_LIST.find(e=>e.id===id); return ex?<div key={id} className="review-row"><span>{ex.label}</span><span>+£{ex.price}</span></div>:null; })}
            </div>
          )}

          {/* Price breakdown */}
          <div className="review-section review-total-section">
            <div className="review-row"><span>Fare per passenger</span><span>£{pricePerPax}</span></div>
            <div className="review-row"><span>× {paxCount} passenger{paxCount>1?"s":""}</span><span>£{baseFareTotal}</span></div>
            {seatCostTotal > 0 && <div className="review-row"><span>Seat selection</span><span>+£{seatCostTotal}</span></div>}
            {extrasCost > 0 && <div className="review-row"><span>Extras</span><span>+£{extrasCost}</span></div>}
            <div className="review-row review-row--total"><span>Total</span><span>£{total}</span></div>
          </div>

          {/* Payment */}
          <div className="payment-section">
            <h3>Payment Details</h3>
            {savedCard && (
              <div className="saved-card-panel">
                <div>
                  <strong>Saved card</strong>
                  <div className="saved-card-meta">{savedCard.maskedNumber} · {savedCard.expiryDisplay} · {savedCard.cardholderName}</div>
                </div>
                <div className="saved-card-actions">
                  <button
                    type="button"
                    className="saved-card-btn"
                    onClick={() => setUseSavedCard((prev) => !prev)}
                  >
                    {useSavedCard ? "Use a different card" : "Use saved card"}
                  </button>
                  <button
                    type="button"
                    className="saved-card-btn saved-card-btn--danger"
                    onClick={() => {
                      clearSavedCard();
                      setSavedCard(null);
                      setUseSavedCard(false);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
            <div className="payment-trust-row">
              <div className="payment-trust-pill">Instant confirmation</div>
              <div className="payment-trust-pill">No CVV saved</div>
              <div className="payment-trust-pill">Secure checkout</div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{flex:2}}>
                <label>Card number</label>
                <input
                  value={useSavedCard && savedCard ? savedCard.maskedNumber : cardNum}
                  onChange={e=>setCardNum(e.target.value)}
                  placeholder="1234 5678 9012 3456"
                  readOnly={useSavedCard && Boolean(savedCard)}
                />
                {!useSavedCard && cardBrand && <div className="payment-field-hint">{cardBrand}</div>}
                {!useSavedCard && activeCardNumber && !cardNumberValid && (
                  <div className="payment-field-error">Enter a valid card number.</div>
                )}
              </div>
              <div className="form-group">
                <label>Expiry</label>
                <input
                  value={useSavedCard && savedCard ? savedCard.expiryDisplay : cardExp}
                  onChange={e=>setCardExp(e.target.value)}
                  placeholder="MM / YY"
                  readOnly={useSavedCard && Boolean(savedCard)}
                />
                {!useSavedCard && activeCardExpiry && !expiryValid && (
                  <div className="payment-field-error">Use a valid future expiry date.</div>
                )}
              </div>
              <div className="form-group">
                <label>CVV</label>
                <input type="password" value={cardCvv} onChange={e=>setCardCvv(e.target.value)} placeholder="123" />
                {cardCvv && !cvvValid && (
                  <div className="payment-field-error">Enter a valid CVV.</div>
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Name on card</label>
              <input
                value={useSavedCard && savedCard ? savedCard.cardholderName : cardName}
                onChange={e=>setCardName(e.target.value)}
                placeholder="As it appears on your card"
                readOnly={useSavedCard && Boolean(savedCard)}
              />
              {!useSavedCard && activeCardName && activeCardName.trim().length < 3 && (
                <div className="payment-field-error">Enter the full cardholder name.</div>
              )}
            </div>
            <div className="payment-secure-note">🔒 Secured with 3D Secure &amp; PCI-DSS encryption</div>
            <div className={`payment-readiness ${paymentReady ? "payment-readiness--ready" : ""}`}>
              {paymentReady
                ? "Payment details look good. You can confirm your booking."
                : "Complete valid payment details to enable a smoother checkout."}
            </div>
          </div>

          {!useSavedCard && (
            <label className="remember-card-label">
              <input type="checkbox" checked={rememberCard} onChange={e=>setRememberCard(e.target.checked)} />
              <span>Remember this card on this device with the number partially hidden</span>
            </label>
          )}

          <label className="tcs-label">
            <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} />
            <span>I agree to the <span className="link-btn">Terms &amp; Conditions</span> and <span className="link-btn">Privacy Policy</span></span>
          </label>

          {submitErr && <div className="form-error">⚠ {submitErr}</div>}

          <div className="flow-actions">
            <button className="flow-back-btn" onClick={()=>setStep(3)}>← Back</button>
            <button className="flow-pay-btn" onClick={handlePay} disabled={!agreed||submitting}>
              {submitting?"Processing…":`Pay £${total}`}
            </button>
          </div>
        </>)}
      </div></div>
    </div>
  );
}
