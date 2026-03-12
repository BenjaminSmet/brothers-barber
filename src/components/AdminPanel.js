import { useState, useEffect, useCallback } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, Timestamp, where
} from "firebase/firestore";
import { generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

const CORS_PROXY  = process.env.REACT_APP_CORS_PROXY;
const ICAL_BARBER = process.env.REACT_APP_ICAL_BARBER;

// ── iCal fetch ────────────────────────────────────────────────
async function fetchIcal(url) {
  const res = await fetch(CORS_PROXY + encodeURIComponent(url));
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.text();
}

// ── iCal parser — returns availability windows ────────────────
// Looks for events whose summary starts with "Available" (case-insensitive)
// e.g. "Available 14:00-17:00" or just "Available"
function parseAvailability(text) {
  const windows = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const summary = (block.match(/SUMMARY:(.+)/) || [])[1]?.trim() || "";

    // Only process events marked as available
    if (!summary.toLowerCase().startsWith("available")) continue;

    const parseRaw = (raw) => {
      if (!raw) return null;
      const isUtc = raw.endsWith("Z");
      const clean = raw.replace(/Z$/, "");
      const y  = +clean.slice(0, 4);
      const mo = +clean.slice(4, 6) - 1;
      const d  = +clean.slice(6, 8);
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

    windows.push({ summary, start, end });
  }
  return windows;
}

// ── Slot generator — 30-min slots within a window ────────────
function generateSlotsFromWindow(start, end) {
  const slots = [];
  let cur = new Date(start);
  while (cur < end) {
    const slotEnd = new Date(cur.getTime() + 30 * 60000);
    if (slotEnd <= end) slots.push(new Date(cur));
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

// ── Calendar helpers ──────────────────────────────────────────
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

// ── Component ─────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab, setTab] = useState("slots");

  // iCal availability windows
  const [availWindows, setAvailWindows] = useState([]);
  const [calStatus, setCalStatus]       = useState("idle");
  const [calSummary, setCalSummary]     = useState("");

  // Slots in Firestore
  const [slots, setSlots]         = useState([]);
  const [bookedSet, setBookedSet] = useState(new Set());

  // Calendar view
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // Brothers
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName]   = useState("");
  const [users, setUsers]       = useState([]);

  // Upcoming bookings
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  // Modal + toast
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const confirm = (message) =>
    new Promise((resolve) => {
      setModal({
        message,
        onConfirm: () => { setModal(null); resolve(true); },
      });
    });

  // ── Fetch Barber Benjamin calendar ───────────────────────────
  const fetchCalendar = useCallback(async () => {
    if (!ICAL_BARBER) return;
    setCalStatus("loading");
    try {
      const text     = await fetchIcal(ICAL_BARBER);
      const windows  = parseAvailability(text);
      setAvailWindows(windows);
      setCalStatus("loaded");
      setCalSummary(`${windows.length} availability window${windows.length !== 1 ? "s" : ""} found`);
    } catch (err) {
      console.error("iCal fetch failed:", err);
      setCalStatus("error");
    }
  }, []);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  // ── Load Firestore data ───────────────────────────────────────
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

  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "allowedUsers"));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setUsers(list);
    };
    load();
  }, []);

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

  // ── Calendar grid helpers ─────────────────────────────────────
  const year        = currentMonth.getFullYear();
  const month       = currentMonth.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate   = new Date(); todayDate.setHours(0, 0, 0, 0);

  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  // Availability windows for a given day
  const getWindowsForDay = (day) =>
    availWindows.filter(w => {
      const wDay = new Date(w.start); wDay.setHours(0,0,0,0);
      const d    = new Date(day);     d.setHours(0,0,0,0);
      return wDay.getTime() === d.getTime();
    });

  // Firestore slots for a given day
  const getSlotsForDay = (day) =>
    slots.filter(s => s.datetime.toDate().toDateString() === day.toDateString());

  // Pending windows = calendar windows that haven't been imported as slots yet
  const getPendingWindowsForDay = (day) => {
    const existingTimes = new Set(
      getSlotsForDay(day).map(s => s.datetime.toDate().getTime())
    );
    return getWindowsForDay(day).filter(w => {
      const preview = generateSlotsFromWindow(w.start, w.end);
      // A window is "pending" if none of its slots exist in Firestore yet
      return preview.some(dt => !existingTimes.has(dt.getTime()));
    });
  };

  const selectedWindows = selectedDate ? getWindowsForDay(selectedDate)     : [];
  const selectedSlots   = selectedDate ? getSlotsForDay(selectedDate)        : [];
  const pendingWindows  = selectedDate ? getPendingWindowsForDay(selectedDate) : [];

  // ── Import slots from a calendar window ───────────────────────
  const handleImportWindow = async (window) => {
    const preview = generateSlotsFromWindow(window.start, window.end);
    if (preview.length === 0) return showToast("No slots in this window", "error");

    // Skip slots that already exist
    const existingTimes = new Set(
      getSlotsForDay(window.start).map(s => s.datetime.toDate().getTime())
    );
    const toAdd = preview.filter(dt => !existingTimes.has(dt.getTime()));
    if (toAdd.length === 0) return showToast("All slots already imported", "error");

    const newSlots = [];
    for (const dt of toAdd) {
      const label = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const docRef = await addDoc(collection(db, "slots"), {
        datetime: Timestamp.fromDate(dt), label,
      });
      newSlots.push({ id: docRef.id, datetime: Timestamp.fromDate(dt), label });
    }
    setSlots(prev =>
      [...prev, ...newSlots].sort((a, b) => a.datetime.toDate() - b.datetime.toDate())
    );
    showToast(`✅ ${newSlots.length} slots imported!`);
  };

  // Import ALL pending windows across all months at once
  const handleImportAll = async () => {
    const allPending = availWindows.filter(w => {
      const existingTimes = new Set(
        getSlotsForDay(w.start).map(s => s.datetime.toDate().getTime())
      );
      return generateSlotsFromWindow(w.start, w.end)
        .some(dt => !existingTimes.has(dt.getTime()));
    });

    if (allPending.length === 0) return showToast("Nothing new to import", "error");

    let total = 0;
    for (const window of allPending) {
      const preview = generateSlotsFromWindow(window.start, window.end);
      const existingTimes = new Set(
        getSlotsForDay(window.start).map(s => s.datetime.toDate().getTime())
      );
      const toAdd = preview.filter(dt => !existingTimes.has(dt.getTime()));
      const newSlots = [];
      for (const dt of toAdd) {
        const label = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const docRef = await addDoc(collection(db, "slots"), {
          datetime: Timestamp.fromDate(dt), label,
        });
        newSlots.push({ id: docRef.id, datetime: Timestamp.fromDate(dt), label });
        total++;
      }
      setSlots(prev =>
        [...prev, ...newSlots].sort((a, b) => a.datetime.toDate() - b.datetime.toDate())
      );
    }
    showToast(`✅ ${total} slots imported from all windows!`);
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
      name:  newName.trim(),
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
    if (calStatus === "loading") return <div className="cal-badge loading">⏳ Reading Barber Benjamin calendar...</div>;
    if (calStatus === "loaded")  return (
      <div className="cal-badge loaded" style={{cursor:"pointer"}} onClick={fetchCalendar}>
        ✅ {calSummary} · <span style={{opacity:0.6}}>click to refresh</span>
      </div>
    );
    if (calStatus === "error") return (
      <div className="cal-badge error" style={{cursor:"pointer"}} onClick={fetchCalendar}>
        ⚠️ Could not read calendar · click to retry
      </div>
    );
    return null;
  };

  const today = new Date(); today.setHours(0,0,0,0);

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

          {/* How it works */}
          <div className="slot-form">
            <h3>📱 HOW IT WORKS</h3>
            <div className="ical-instructions">
              <strong>On your iPhone:</strong>
              <span>1. Open Calendar → create an event in your <em>Barber Benjamin</em> calendar</span>
              <span>2. Name it <strong>Available</strong> (e.g. "Available" from 14:00 to 17:00)</span>
              <span>3. Come back here → click refresh on the badge above → import the slots</span>
            </div>
            {calStatus === "loaded" && availWindows.length > 0 && (
              <button className="add-slot-btn" style={{marginTop:"1rem"}} onClick={handleImportAll}>
                ⬇ Import all {availWindows.length} window{availWindows.length !== 1 ? "s" : ""} at once
              </button>
            )}
          </div>

          {/* Calendar view */}
          <div className="slot-form">
            <h3>📅 YOUR CALENDAR</h3>
            <p style={{color:"var(--gray-light)", fontSize:"0.85rem", marginBottom:"1rem"}}>
              🟡 = availability window from calendar (tap to import) · 🟢 dot = slots already added
            </p>
            <div className="calendar-header">
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}>‹</button>
              <span style={{fontWeight:600}}>{MONTHS[month]} {year}</span>
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}>›</button>
            </div>
            <div className="cal-grid" style={{marginBottom:"1rem"}}>
              {DAYS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
              {calDays.map((day, i) => {
                if (!day) return <div key={i} className="cal-day empty" />;
                const isPast     = day < todayDate;
                const isToday    = day.toDateString() === todayDate.toDateString();
                const isSelected = selectedDate?.toDateString() === day.toDateString();
                const hasWindows = getWindowsForDay(day).length > 0;
                const hasSlots   = getSlotsForDay(day).length > 0;
                const hasPending = !isPast && getPendingWindowsForDay(day).length > 0;
                return (
                  <div key={i}
                    className={[
                      "cal-day",
                      isPast     ? "disabled" : "",
                      isToday    ? "today"    : "",
                      isSelected ? "selected" : "",
                      hasPending ? "has-pending" : (hasWindows && !isPast ? "has-busy" : ""),
                    ].filter(Boolean).join(" ")}
                    onClick={() => day && setSelectedDate(day)}
                  >
                    {day.getDate()}
                    {hasSlots && !isPast && <div className="cal-dot" />}
                  </div>
                );
              })}
            </div>

            {/* Selected day detail */}
            {selectedDate && (
              <div className="day-detail">
                <h4 className="day-detail-title">
                  {selectedDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })}
                </h4>

                {/* Pending windows to import */}
                {pendingWindows.length > 0 && (
                  <div className="day-detail-section">
                    <span className="day-detail-label" style={{color:"var(--warning)"}}>
                      🟡 Available windows (not yet imported)
                    </span>
                    {pendingWindows.map((w, i) => {
                      const preview = generateSlotsFromWindow(w.start, w.end);
                      return (
                        <div key={i} className="day-event-row" style={{background:"rgba(230,126,34,0.1)", justifyContent:"space-between"}}>
                          <span>
                            {w.start.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                            {" – "}
                            {w.end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                            <span style={{color:"var(--gray-light)", fontSize:"0.75rem", marginLeft:"0.5rem"}}>
                              ({preview.length} slots)
                            </span>
                          </span>
                          <button className="import-window-btn" onClick={() => handleImportWindow(w)}>
                            + Import
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Already imported slots */}
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

                {selectedWindows.length === 0 && selectedSlots.length === 0 && (
                  <p style={{color:"var(--gray-light)", fontSize:"0.85rem"}}>
                    Nothing here — add an "Available" event in your Barber Benjamin calendar on iPhone.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* All slots list */}
          <div className="existing-slots">
            <h3>ALL SLOTS</h3>
            {slots.length === 0 ? (
              <p style={{color:"var(--gray-light)"}}>No slots yet.</p>
            ) : (
              <div className="slots-table">
                {slots.map(slot => {
                  const d        = slot.datetime.toDate();
                  const isPast   = d < today;
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
