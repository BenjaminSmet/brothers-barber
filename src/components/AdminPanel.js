import { useState, useEffect, useCallback } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, Timestamp, where
} from "firebase/firestore";
import { generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

// Try multiple proxies in order until one works
const PROXIES = [
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?url=",
  "https://proxy.cors.sh/",
];

const ICAL_PRIVE = process.env.REACT_APP_ICAL_PRIVE;
const ICAL_WERK  = process.env.REACT_APP_ICAL_WERK;

// ── iCal parser ───────────────────────────────────────────────
function parseIcal(text) {
  const events = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const summary = (block.match(/SUMMARY:(.+)/) || [])[1]?.trim() || "Busy";

    const parseRaw = (raw) => {
      if (!raw) return null;
      const isUtc = raw.endsWith("Z");
      const clean = raw.replace(/Z$/, "");
      const y  = +clean.slice(0, 4);
      const mo = +clean.slice(4, 6) - 1;
      const d  = +clean.slice(6, 8);
      // All-day events have no time component (length 8)
      if (clean.length === 8) return new Date(y, mo, d, 0, 0);
      const h = +clean.slice(9, 11);
      const m = +clean.slice(11, 13);
      return isUtc
        ? new Date(Date.UTC(y, mo, d, h, m))
        : new Date(y, mo, d, h, m);
    };

    const dtStartRaw = (block.match(/DTSTART(?:;[^:]+)?:(\S+)/) || [])[1];
    const dtEndRaw   = (block.match(/DTEND(?:;[^:]+)?:(\S+)/)   || [])[1];
    const start = parseRaw(dtStartRaw);
    const end   = parseRaw(dtEndRaw);
    if (!start || !end) continue;
    events.push({ summary, start, end });
  }
  return events;
}

// Fetch a URL trying each proxy until one succeeds
async function fetchWithFallback(url) {
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy + encodeURIComponent(url));
      if (res.ok) return await res.text();
    } catch (_) {}
  }
  throw new Error("All proxies failed for: " + url);
}

// ── Slot generator ────────────────────────────────────────────
function generateSlots(date, fromTime, toTime, busyEvents) {
  const [fh, fm] = fromTime.split(":").map(Number);
  const [th, tm] = toTime.split(":").map(Number);
  const slots = [];
  let cur = new Date(date); cur.setHours(fh, fm, 0, 0);
  const end = new Date(date); end.setHours(th, tm, 0, 0);
  while (cur < end) {
    const slotEnd = new Date(cur.getTime() + 30 * 60000);
    const isBusy = busyEvents.some(ev => cur < ev.end && slotEnd > ev.start);
    if (!isBusy) slots.push(new Date(cur));
    cur = slotEnd;
  }
  return slots;
}

// ── Confirmation modal ────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-box">
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-confirm" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Calendar view helpers ─────────────────────────────────────
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

export default function AdminPanel() {
  const [tab, setTab] = useState("slots");

  // Slots
  const [slotDate, setSlotDate]   = useState("");
  const [fromTime, setFromTime]   = useState("09:00");
  const [toTime, setToTime]       = useState("17:00");
  const [slots, setSlots]         = useState([]);
  const [bookedSet, setBookedSet] = useState(new Set());

  // Calendar view
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // iCal
  const [busyEvents, setBusyEvents] = useState([]);
  const [calStatus, setCalStatus]   = useState("idle");
  const [calSummary, setCalSummary] = useState("");

  // Brothers
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName]   = useState("");
  const [users, setUsers]       = useState([]);

  // Upcoming bookings
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  // Modal
  const [modal, setModal] = useState(null); // { message, onConfirm }

  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const confirm = (message) =>
    new Promise((resolve) => {
      setModal({ message, onConfirm: () => { setModal(null); resolve(true); } });
    });

  // ── Auto-fetch iCal ──────────────────────────────────────────
  const fetchCalendars = useCallback(async () => {
    if (!ICAL_PRIVE && !ICAL_WERK) return;
    setCalStatus("loading");
    try {
      const urls = [ICAL_PRIVE, ICAL_WERK].filter(Boolean);
      const texts = await Promise.all(urls.map(fetchWithFallback));
      const allEvents = texts.flatMap(parseIcal);
      setBusyEvents(allEvents);
      setCalStatus("loaded");
      const names = [ICAL_PRIVE && "Privé", ICAL_WERK && "Werk"].filter(Boolean).join(" + ");
      setCalSummary(`${names} — ${allEvents.length} events loaded`);
    } catch (err) {
      console.error("iCal fetch failed:", err);
      setCalStatus("error");
    }
  }, []);

  useEffect(() => { fetchCalendars(); }, [fetchCalendars]);

  // ── Load slots ───────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const snap  = await getDocs(query(collection(db, "slots")));
      const bsnap = await getDocs(collection(db, "bookings"));
      const list  = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.datetime.toDate() - b.datetime.toDate());
      setSlots(list);
      const booked = new Set();
      bsnap.forEach(d => booked.add(d.data().slotId));
      setBookedSet(booked);
    };
    load();
  }, []);

  // ── Load brothers ────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "allowedUsers"));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setUsers(list);
    };
    load();
  }, []);

  // ── Load upcoming bookings ───────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const now  = Timestamp.fromDate(new Date());
      const snap = await getDocs(query(collection(db, "bookings"), where("slotDate", ">=", now)));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.slotDate.toDate() - b.slotDate.toDate());
      setUpcomingBookings(list);
    };
    load();
  }, []);

  // ── Calendar view data ───────────────────────────────────────
  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate   = new Date(); todayDate.setHours(0, 0, 0, 0);

  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  // For a given day, what's busy / what slots exist
  const getBusyForDay = (day) =>
    busyEvents.filter(ev => {
      const s = new Date(ev.start); s.setHours(0,0,0,0);
      const e = new Date(ev.end);   e.setHours(0,0,0,0);
      const d = new Date(day);      d.setHours(0,0,0,0);
      return d >= s && d < e;
    });

  const getSlotsForDay = (day) =>
    slots.filter(s => s.datetime.toDate().toDateString() === day.toDateString());

  // selected day details
  const selectedBusy  = selectedDate ? getBusyForDay(selectedDate)  : [];
  const selectedSlots = selectedDate ? getSlotsForDay(selectedDate) : [];

  // colour a calendar day
  const getDayClass = (day) => {
    if (!day) return "cal-day empty";
    const isPast = day < todayDate;
    const isToday    = day.toDateString() === todayDate.toDateString();
    const isSelected = selectedDate?.toDateString() === day.toDateString();
    const hasBusy    = getBusyForDay(day).length > 0;
    const hasSlots   = getSlotsForDay(day).length > 0;
    return [
      "cal-day",
      isPast    ? "disabled" : "",
      isToday   ? "today"    : "",
      isSelected? "selected" : "",
      hasBusy   ? "has-busy" : "",
      hasSlots  ? "has-free" : "",
    ].filter(Boolean).join(" ");
  };

  // ── Slot form preview ────────────────────────────────────────
  const preview = (slotDate && fromTime && toTime)
    ? generateSlots(new Date(slotDate + "T00:00"), fromTime, toTime, busyEvents)
    : [];
  const totalPossible = (slotDate && fromTime && toTime)
    ? generateSlots(new Date(slotDate + "T00:00"), fromTime, toTime, []).length
    : 0;
  const blockedCount = totalPossible - preview.length;

  // ── Handlers ─────────────────────────────────────────────────
  const handleAddSlots = async () => {
    if (!slotDate || !fromTime || !toTime) return showToast("Fill in date and times", "error");
    if (preview.length === 0) return showToast("No free slots in this window", "error");
    const newSlots = [];
    for (const dt of preview) {
      const label = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const docRef = await addDoc(collection(db, "slots"), {
        datetime: Timestamp.fromDate(dt), label,
      });
      newSlots.push({ id: docRef.id, datetime: Timestamp.fromDate(dt), label });
    }
    setSlots(prev => [...prev, ...newSlots].sort((a, b) => a.datetime.toDate() - b.datetime.toDate()));
    showToast(`✅ ${newSlots.length} slots added!`);
    setSlotDate("");
  };

  const handleDeleteSlot = async (slotId, label) => {
    await confirm(`Delete the ${label} slot?`);
    await deleteDoc(doc(db, "slots", slotId));
    setSlots(prev => prev.filter(s => s.id !== slotId));
    showToast("Slot removed.");
  };

  const handleAddUser = async () => {
    if (!newEmail) return showToast("Enter an email", "error");
    const docRef = await addDoc(collection(db, "allowedUsers"), {
      email: newEmail.trim().toLowerCase(),
      name: newName.trim(),
      addedAt: Timestamp.now(),
    });
    setUsers(prev => [...prev, { id: docRef.id, email: newEmail.trim().toLowerCase(), name: newName.trim() }]);
    setNewEmail(""); setNewName("");
    showToast("✅ Brother added!");
  };

  const handleRemoveUser = async (userId, name) => {
    await confirm(`Remove ${name || "this brother"}?`);
    await deleteDoc(doc(db, "allowedUsers", userId));
    setUsers(prev => prev.filter(u => u.id !== userId));
    showToast("User removed.");
  };

  const handleAddBookingToCalendar = (b) => {
    const ics = generateIcs({
      title: `✂️ Haircut — ${b.userName}`,
      start: b.slotDate.toDate(),
      description: `Haircut with ${b.userName} (${b.userEmail})`,
    });
    const a = document.createElement("a");
    a.href = makeIcsDataUri(ics);
    a.download = `haircut-${b.userName.split(" ")[0].toLowerCase()}.ics`;
    a.click();
  };

  // ── Calendar status badge ─────────────────────────────────────
  const CalBadge = () => {
    if (calStatus === "loading") return <div className="cal-badge loading">⏳ Syncing Privé + Werk...</div>;
    if (calStatus === "loaded")  return (
      <div className="cal-badge loaded" style={{cursor:"pointer"}} onClick={fetchCalendars}>
        ✅ {calSummary} <span style={{opacity:0.6, fontSize:"0.75rem"}}>· click to refresh</span>
      </div>
    );
    if (calStatus === "error")   return (
      <div className="cal-badge error" style={{cursor:"pointer"}} onClick={fetchCalendars}>
        ⚠️ Could not load calendars · click to retry
      </div>
    );
    return null;
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      {modal && (
        <ConfirmModal
          message={modal.message}
          onConfirm={modal.onConfirm}
          onCancel={() => setModal(null)}
        />
      )}

      <div className="section-header">
        <h2>⚙ Admin Panel</h2>
        <p>Manage your availability, brothers, and bookings</p>
      </div>

      <CalBadge />

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === "slots"    ? "active" : ""}`} onClick={() => setTab("slots")}>📅 Manage Slots</button>
        <button className={`admin-tab ${tab === "brothers" ? "active" : ""}`} onClick={() => setTab("brothers")}>👥 Brothers</button>
        <button className={`admin-tab ${tab === "bookings" ? "active" : ""}`} onClick={() => setTab("bookings")}>📋 Upcoming Bookings</button>
      </div>

      {/* ── SLOTS ── */}
      {tab === "slots" && (
        <div className="slot-manager">

          {/* Calendar view */}
          <div className="slot-form">
            <h3>📅 YOUR CALENDAR</h3>
            <p style={{color:"var(--gray-light)", fontSize:"0.85rem", marginBottom:"1rem"}}>
              Red = busy (Privé/Werk). Green dot = open slots you've added. Click a day to see details.
            </p>
            <div className="calendar-header">
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}>‹</button>
              <span style={{fontWeight:600}}>{MONTHS[month]} {year}</span>
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}>›</button>
            </div>
            <div className="cal-grid" style={{marginBottom:"1rem"}}>
              {DAYS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
              {calDays.map((day, i) => (
                <div key={i} className={getDayClass(day)}
                  onClick={() => day && !day < todayDate && setSelectedDate(day)}>
                  {day?.getDate()}
                  {day && getSlotsForDay(day).length > 0 && <div className="cal-dot" />}
                  {day && getBusyForDay(day).length > 0 && !day < todayDate && <div className="cal-dot busy-dot" />}
                </div>
              ))}
            </div>

            {/* Selected day detail */}
            {selectedDate && (
              <div className="day-detail">
                <h4 className="day-detail-title">
                  {selectedDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })}
                </h4>
                {selectedBusy.length > 0 && (
                  <div className="day-detail-section">
                    <span className="day-detail-label busy">🔴 Busy (from calendar)</span>
                    {selectedBusy.map((ev, i) => (
                      <div key={i} className="day-event-row busy">
                        <span>{ev.summary}</span>
                        <span>{ev.start.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} – {ev.end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selectedSlots.length > 0 && (
                  <div className="day-detail-section">
                    <span className="day-detail-label free">🟢 Open slots</span>
                    {selectedSlots.map(s => (
                      <div key={s.id} className="day-event-row free">
                        <span>{s.label}</span>
                        {bookedSet.has(s.id)
                          ? <span className="slot-booked-badge">BOOKED</span>
                          : <button className="delete-slot-btn" onClick={() => handleDeleteSlot(s.id, s.label)}>✕</button>
                        }
                      </div>
                    ))}
                  </div>
                )}
                {selectedBusy.length === 0 && selectedSlots.length === 0 && (
                  <p style={{color:"var(--gray-light)", fontSize:"0.85rem"}}>Nothing scheduled — add slots below.</p>
                )}
              </div>
            )}
          </div>

          {/* Add slots form */}
          <div className="slot-form">
            <h3>ADD AVAILABLE TIME WINDOW</h3>
            <p style={{color:"var(--gray-light)", fontSize:"0.85rem", marginBottom:"1rem"}}>
              Slots every 30 min{calStatus === "loaded" ? ", busy times from Privé + Werk auto-blocked" : ""}.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={slotDate} onChange={e => setSlotDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]} />
              </div>
              <div className="form-group">
                <label>From</label>
                <input type="time" value={fromTime} onChange={e => setFromTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Until</label>
                <input type="time" value={toTime} onChange={e => setToTime(e.target.value)} />
              </div>
            </div>

            {slotDate && fromTime && toTime && (
              <div className="slot-preview">
                <span className="slot-preview-label">
                  {preview.length === 0
                    ? "⚠️ No free slots — entire window is blocked by your calendar"
                    : `Preview — ${preview.length} free slot${preview.length !== 1 ? "s" : ""}${blockedCount > 0 ? ` (${blockedCount} blocked by calendar)` : ""}:`}
                </span>
                <div className="slot-preview-pills">
                  {preview.map((dt, i) => (
                    <span key={i} className="slot-pill">
                      {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button className="add-slot-btn" onClick={handleAddSlots} disabled={preview.length === 0}>
              + Add {preview.length > 0 ? `${preview.length} Slot${preview.length !== 1 ? "s" : ""}` : "Slots"}
            </button>
          </div>

          {/* All existing slots list */}
          <div className="existing-slots">
            <h3>ALL SLOTS</h3>
            {slots.length === 0 ? (
              <p style={{color:"var(--gray-light)"}}>No slots yet.</p>
            ) : (
              <div className="slots-table">
                {slots.map(slot => {
                  const d = slot.datetime.toDate();
                  const isPast = d < today;
                  const isBooked = bookedSet.has(slot.id);
                  return (
                    <div key={slot.id} className="slot-row" style={isPast ? {opacity:0.4} : {}}>
                      <div className="slot-row-info">
                        <strong>{d.toLocaleDateString("en-GB", { weekday:"short", month:"short", day:"numeric" })}</strong>
                        <span>{slot.label}</span>
                        {isBooked && <span className="slot-booked-badge" style={{marginLeft:"0.75rem"}}>BOOKED</span>}
                      </div>
                      {!isBooked && !isPast && (
                        <button className="delete-slot-btn" onClick={() => handleDeleteSlot(slot.id, slot.label)}>✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BROTHERS ── */}
      {tab === "brothers" && (
        <div className="whitelist-manager">
          <div className="add-user-form">
            <div className="form-group">
              <label>Google Email</label>
              <input type="email" placeholder="brother@gmail.com"
                value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Name (optional)</label>
              <input type="text" placeholder="e.g. Rayan"
                value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <button className="add-user-btn" onClick={handleAddUser}>+ Add Brother</button>
          </div>
          <div className="users-list">
            {users.length === 0 ? (
              <p style={{color:"var(--gray-light)"}}>No brothers added yet.</p>
            ) : users.map(u => (
              <div key={u.id} className="user-row">
                <div className="user-row-info">
                  <strong>{u.name || "—"}</strong>
                  <small>{u.email}</small>
                </div>
                <button className="delete-slot-btn" onClick={() => handleRemoveUser(u.id, u.name)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── UPCOMING BOOKINGS ── */}
      {tab === "bookings" && (
        <div className="upcoming-bookings">
          {upcomingBookings.length === 0 ? (
            <div className="empty-state">
              <div className="big-icon">📭</div>
              <p>No upcoming bookings yet.</p>
            </div>
          ) : upcomingBookings.map(b => (
            <div key={b.id} className="admin-booking-card">
              <div>
                <div className="who">{b.userName}</div>
                <div className="when">
                  {b.slotDate.toDate().toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })} at {b.slotTime}
                </div>
                <small style={{color:"var(--gray-light)", fontSize:"0.75rem"}}>{b.userEmail}</small>
              </div>
              <div style={{display:"flex", alignItems:"center", gap:"0.75rem"}}>
                <button className="cal-mini-btn" onClick={() => handleAddBookingToCalendar(b)} title="Add to my calendar">📅</button>
                <span className="admin-badge">BOOKED</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
