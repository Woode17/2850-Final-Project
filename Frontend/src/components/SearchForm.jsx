import { useState, useRef, useEffect, useCallback } from "react";
import { buildApiUrl } from "../services/api";

// ── Airport data ──────────────────────────────────────────

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── Hook: fetch lowest prices per day for a route + month ─
function useMonthPrices(from, to, year, month) {
  const [prices,  setPrices]  = useState({}); // { "2026-04-15": 89, ... }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!from || !to) { setPrices({}); return; }
    let cancelled = false;
    setLoading(true);

    function pad(n) { return String(n).padStart(2, "0"); }
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Build all dates in this month
    const dates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`${year}-${pad(month + 1)}-${pad(d)}`);
    }

    Promise.all(
      dates.map(date =>
        fetch(buildApiUrl(`/flights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&departureDate=${date}`))
          .then(r => r.ok ? r.json() : [])
          .then(flights => {
            if (flights && flights.length > 0) {
              return [date, Math.min(...flights.map(f => f.price))];
            }
            return [date, null];
          })
          .catch(() => [date, null])
      )
    ).then(results => {
      if (cancelled) return;
      const map = {};
      results.forEach(([d, p]) => { map[d] = p; });
      setPrices(map);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [from, to, year, month]);

  return { prices, loading };
}

// ── AirportPicker ─────────────────────────────────────────
function AirportPicker({ label, value, onChange, exclude }) {
  const [AIRPORTS, setAIRPORTS] = useState([]);
  const [query,   setQuery]  = useState("");
  const [open,    setOpen]   = useState(false);
  const wrapRef              = useRef(null);
  const inputRef             = useRef(null);

  const selected = AIRPORTS.find((a) => a.code === value);
  const filtered = AIRPORTS.filter((a) => {
    if (a.code === exclude) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) ||
           a.city.toLowerCase().includes(q) || a.country.toLowerCase().includes(q);
  });

  useEffect(() => {
    const fetchAirports = async () => {
      try {
        const res = await fetch("/api/airports");
        const data = await res.json();
        setAIRPORTS(data);
      } catch (err) {
        console.error("Failed to load airports:", err);
      }
    };

    fetchAirports();
  }, []);

  useEffect(() => {
    function handle(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  function select(airport) { onChange(airport.code); setOpen(false); setQuery(""); }

  return (
    <div className="airport-picker" ref={wrapRef}>
      <label className="field-label">{label}</label>
      <div className={"airport-input-wrap" + (open ? " open" : "") + (value ? " has-value" : "")} onClick={() => setOpen(true)}>
        {selected && !open ? (
          <div className="airport-selected">
            <span className="airport-flag-large">{selected.flag}</span>
            <div className="airport-selected-text">
              <span className="airport-selected-code">{selected.code}</span>
              <span className="airport-selected-city">{selected.city}</span>
            </div>
          </div>
        ) : (
          <input ref={inputRef} className="airport-text-input" placeholder="City or airport code..."
            value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} autoComplete="off" />
        )}
        <span className="airport-chevron">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="airport-dropdown">
          {!query && <div className="airport-dropdown-hint">Popular airports</div>}
          {filtered.length === 0 && <div className="airport-no-results">No airports found for "{query}"</div>}
          {filtered.map(airport => (
            <div key={airport.code}
              className={"airport-option" + (value === airport.code ? " selected" : "")}
              onMouseDown={e => { e.preventDefault(); select(airport); }}>
              <span className="airport-option-flag">{airport.flag}</span>
              <div className="airport-option-info">
                <div className="airport-option-top">
                  <span className="airport-option-code">{airport.code}</span>
                  <span className="airport-option-city">{airport.city}, {airport.country}</span>
                </div>
                <span className="airport-option-name">{airport.name}</span>
              </div>
              {value === airport.code && <span className="airport-check">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CalendarPicker — fetches real prices from API ─────────
function CalendarPicker({ label, value, onChange, minDate, icon, from, to }) {
  const [open, setOpen] = useState(false);
  const wrapRef         = useRef(null);

  const todayObj = new Date();
  todayObj.setHours(0, 0, 0, 0);
  const minD = minDate
    ? (() => { const d = new Date(minDate + "T00:00:00"); d.setHours(0,0,0,0); return d; })()
    : todayObj;

  const initDisplay = value
    ? new Date(value + "T00:00:00")
    : (minD > todayObj ? minD : todayObj);
  const [viewYear,  setViewYear]  = useState(initDisplay.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDisplay.getMonth());

  // Fetch real prices for this month + route
  const { prices: fetchedPrices, loading: pricesLoading } = useMonthPrices(
    from, to, viewYear, viewMonth
  );

  useEffect(() => {
    function handle(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    if (!minDate) return;
    const min = new Date(minDate + "T00:00:00");
    if (new Date(viewYear, viewMonth, 1) < new Date(min.getFullYear(), min.getMonth(), 1)) {
      setViewYear(min.getFullYear());
      setViewMonth(min.getMonth());
    }
  }, [minDate]);

  function pad(n) { return String(n).padStart(2, "0"); }
  function toIso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

  const todayIso    = toIso(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate());
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const rawFirstDay = new Date(viewYear, viewMonth, 1).getDay();
  const firstDay    = rawFirstDay === 0 ? 6 : rawFirstDay - 1;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function canGoPrev() {
    return new Date(viewYear, viewMonth - 1, 1) >= new Date(todayObj.getFullYear(), todayObj.getMonth(), 1);
  }
  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }
  function selectDay(day) {
    const iso = toIso(viewYear, viewMonth, day);
    if (new Date(iso + "T00:00:00") < minD) return;
    onChange(iso);
    setOpen(false);
  }
  function formatDisplay(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return new Date(Number(y), Number(m) - 1, Number(d))
      .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  // Compute cheapest day in this month from fetched data
  const monthPrices = Object.entries(fetchedPrices)
    .filter(([k, v]) => k.startsWith(`${viewYear}-${pad(viewMonth + 1)}`) && v !== null)
    .map(([, v]) => v);
  const lowestFare = monthPrices.length ? Math.min(...monthPrices) : null;
  const hasPrices  = from && to; // only show price hints when route is set

  return (
    <div className="cal-picker" ref={wrapRef}>
      <label className="field-label">{label}</label>
      <div className={"cal-input-wrap" + (open ? " open" : "") + (value ? " has-value" : "")}
           onClick={() => setOpen(o => !o)}>
        <span className="cal-input-icon">{icon || "📅"}</span>
        <span className="cal-display-text">
          {value ? formatDisplay(value) : <span className="cal-placeholder">Select date</span>}
        </span>
        <span className="cal-chevron">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="cal-dropdown">
          <div className="cal-header">
            <button type="button" className="cal-nav-btn" onClick={prevMonth} disabled={!canGoPrev()}>‹</button>
            <div className="cal-header-center">
              <span className="cal-month-name">{MONTHS[viewMonth]}</span>
              <span className="cal-year">{viewYear}</span>
              {hasPrices && lowestFare && !pricesLoading && (
                <span className="cal-lowest-badge">From £{lowestFare}</span>
              )}
              {hasPrices && pricesLoading && (
                <span className="cal-lowest-badge" style={{opacity:.6}}>Loading prices…</span>
              )}
              {hasPrices && !pricesLoading && !lowestFare && (
                <span className="cal-lowest-badge" style={{background:"var(--muted)",color:"white"}}>No flights this month</span>
              )}
            </div>
            <button type="button" className="cal-nav-btn" onClick={nextMonth}>›</button>
          </div>

          <div className="cal-grid">
            {DAYS.map(d => <div key={d} className="cal-day-header">{d}</div>)}
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} />;
              const iso        = toIso(viewYear, viewMonth, day);
              const isDisabled = new Date(iso + "T00:00:00") < minD;
              const isSelected = iso === value;
              const isToday    = iso === todayIso;
              // Only show price if route is selected and price exists for this day
              const fare       = (hasPrices && !pricesLoading) ? fetchedPrices[iso] : undefined;
              const isLowest   = fare !== null && fare !== undefined && fare === lowestFare;
              const col        = (firstDay + day - 1) % 7;
              const isWeekend  = col >= 5;

              return (
                <div key={day}
                  className={[
                    "cal-cell",
                    isDisabled ? "cal-disabled" : "cal-available",
                    isSelected ? "cal-selected" : "",
                    isToday    ? "cal-today"    : "",
                    isWeekend && !isDisabled ? "cal-weekend" : "",
                    isLowest   ? "cal-best-fare" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => selectDay(day)}>
                  <span className="cal-day-num">{day}</span>
                  {/* Show price tag only if fare exists (flight on that day for this route) */}
                  {fare !== null && fare !== undefined && !isDisabled && (
                    <span className={"cal-fare-tag" + (isLowest ? " best" : "")}>£{fare}</span>
                  )}
                  {/* Show loading dots if prices still fetching and route is set */}
                  {hasPrices && pricesLoading && !isDisabled && (
                    <span className="cal-fare-loading">·</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cal-footer">
            <div className="cal-legend">
              <span className="cal-legend-item"><span className="cal-legend-swatch today-swatch"/>Today</span>
              <span className="cal-legend-item"><span className="cal-legend-swatch fare-swatch"/>Flight available</span>
              <span className="cal-legend-item"><span className="cal-legend-swatch best-swatch"/>Best price</span>
            </div>
            {!from || !to ? (
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".4rem"}}>
                Select departure and arrival airports to see fare prices
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PassengerCounter ──────────────────────────────────────
function PassengerCounter({ label, subtitle, min, max, value, onChange }) {
  return (
    <div className="pax-row">
      <div className="pax-label-wrap">
        <span className="pax-label">{label}</span>
        {subtitle && <span className="pax-subtitle">{subtitle}</span>}
      </div>
      <div className="pax-controls">
        <button type="button" className="pax-btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
        <span className="pax-num">{value}</span>
        <button type="button" className="pax-btn" onClick={() => onChange(value + 1)} disabled={max !== undefined && value >= max}>+</button>
      </div>
    </div>
  );
}

// ── SearchForm ────────────────────────────────────────────
export function SearchForm({ onSearch }) {
  const [tripType,      setTripType]      = useState("one-way");
  const [from,          setFrom]          = useState("");
  const [to,            setTo]            = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate,    setReturnDate]    = useState("");
  const [travelClass,   setTravelClass]   = useState("economy");
  const [adults,        setAdults]        = useState(1);
  const [children,      setChildren]      = useState(0);
  const [infants,       setInfants]       = useState(0);

  const _td = new Date(); const today = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,"0")}-${String(_td.getDate()).padStart(2,"0")}`;
  const total = adults + children + infants;

  function handleSubmit(e) {
    e.preventDefault();
    if (!from || !to || !departureDate) return;
    onSearch({ tripType, from, to, departureDate, travelClass, adults, children, infants,
               ...(tripType === "round-trip" ? { returnDate } : {}) });
  }

  function swapAirports() {
    const tmp = from; setFrom(to); setTo(tmp);
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <div className="trip-type-row">
        {[["one-way","✈ One Way"],["round-trip","↔ Round Trip"]].map(([val,lbl]) => (
          <label key={val} className={"trip-pill" + (tripType === val ? " active" : "")}>
            <input type="radio" value={val} checked={tripType === val}
              onChange={() => setTripType(val)} style={{ display:"none" }} />
            {lbl}
          </label>
        ))}
      </div>

      <div className="airport-row">
        <AirportPicker label="From" value={from} onChange={setFrom} exclude={to} />
        <button type="button" className="swap-btn" onClick={swapAirports} title="Swap">⇄</button>
        <AirportPicker label="To"   value={to}   onChange={setTo}   exclude={from} />
      </div>

      <div className="dates-row">
        {/* Pass from/to so calendar can fetch real prices */}
        <CalendarPicker label="Departure" value={departureDate} onChange={setDepartureDate}
          minDate={today} icon="✈" from={from} to={to} />
        {tripType === "round-trip" && (
          <CalendarPicker label="Return" value={returnDate} onChange={setReturnDate}
            minDate={departureDate || today} icon="↩" from={to} to={from} />
        )}
        <div className="class-wrap">
          <label className="field-label">Class</label>
          <select className="class-select" value={travelClass} onChange={e => setTravelClass(e.target.value)}>
            <option value="economy">Economy</option>
            <option value="business">✦ Business</option>
          </select>
        </div>
      </div>

      <div className="pax-search-row">
        <div className="pax-wrap">
          <label className="field-label">Passengers · <span style={{color:"var(--sky)",fontWeight:600}}>{total} selected</span>{total >= 7 && <span style={{color:"#dc2626",fontSize:".75rem",marginLeft:".5rem"}}>Max 7</span>}</label>
          <div className="pax-grid">
            <PassengerCounter label="Adults"   subtitle="16+"  min={1} max={7 - children - infants} value={adults}   onChange={v => setAdults(Math.min(v, 7 - children - infants))} />
            <PassengerCounter label="Children" subtitle="2–15" min={0} max={7 - adults - infants}   value={children} onChange={v => setChildren(Math.min(v, 7 - adults - infants))} />
            <PassengerCounter label="Infants"  subtitle="<2"   min={0} max={7 - adults - children}  value={infants}  onChange={v => setInfants(Math.min(v, 7 - adults - children))} />
          </div>
        </div>
        <button type="submit" className="search-btn" disabled={!from || !to || !departureDate}>
          ✈ &nbsp;Find Flights
        </button>
      </div>
    </form>
  );
}
