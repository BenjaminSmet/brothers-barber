import { useState, useEffect, useCallback } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, Timestamp, where
} from "firebase/firestore";
import { generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

const CORS_PROXY  = process.env.REACT_APP_CORS_PROXY;
const ICAL_BARBER = process.env.REACT_APP_ICAL_BARBER;

async function fetchIcal(url) {
  const res = await fetch(CORS_PROXY + encodeURIComponent(url));
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.text();
}

function parseAvailability(text) {
  const windows = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const summary = (block.match(/SUMMARY:(.+)/) || [])[1]?.trim() || "";
    if (!summary.toLowerCase().startsWith("available")) continue;
    const parseRaw = (raw) => {
      if (!raw) return null;
      const isUtc = raw.endsWith("Z");
      const clean = raw.replace(/Z$/, "");
      const y = +clean.slice(0,4), mo = +clean.slice(4,6)-1, d = +clean.slice(6,8);
      if (clean.length === 8) return new Date(y, mo, d, 0, 0);
      const h = +clean.slice(9,11), m = +clean.slice(11,13);
      return isUtc ? new Date(Date.UTC(y,mo,d,h,m)) : new Date(y,mo,d,h,m);
    };
    const start = parseRaw((block.match(/DTSTART(?:;[^:]+)?:(\S+)/) || [])[1]);
    const end   = parseRaw((block.match(/DTEND(?:;[^:]+)?:(\S+)/)   || [])[1]);
    if (!start || !end) continue;
    windows.push({ summary, start, end });
  }
  return windows;
}

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

const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

export default function AdminPanel() {
  const [tab, setTab] = useState("slots");

  // Availability windows (stored in Firestore as "windows" collection)
  const [windows, setWindows]     = useState([]);
  const [availWindows, setAvailWindows] = useState([]); // from iCal
  const [calStatus, setCalStatus] = useState("idle");
  const [calSummary, setCalSummary] = useState("");

  // Bookings (1-hour blocks)
  const [bookings, setBookings] = useState([]);

  // Calendar view
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // Brothers
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName]   = useState("");
  const [users, setUsers]       = useState([]);

  // Upcoming bookings for admin view
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const confirm = (message) =>
    new Promise((resolve) => {
      setModal({ message, onConfirm: () => { setModal(null); resolve(true); } });
    });

  // ── Fetch iCal ───────────────────────────────────────────────
  const fetchCalendar = useCallback(async () => {
    if (!ICAL_BARBER) return;
    setCalStatus("loading");
    try {
      const text    = await fetchIcal(ICAL_BARBER);
      const parsed  = parseAvailability(text);
      setAvailWindows(parsed);
      setCalStatus("loaded");
      setCalSummary(`${parsed.length} availability window${parsed.length !== 1 ? "s" : ""} found`);
    } catch (err) {
      console.error("iCal fetch failed:", err);
      setCalStatus("error");
    }
  }, []);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  // ── Load windows from Firestore ──────────────────────────────
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(query(collection(db, "windows")));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.start.toDate() - b.start.toDate());
      setWindows(list);
    };
    load();
  }, []);

  // ── Load bookings ────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "bookings"));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setBookings(list);
      const now  = Timestamp.fromDate(new Date());
      const upcoming = list
        .filter(b => b.startTime?.toDate() >= new Date())
        .sort((a, b) => a.startTime.toDate() - b.startTime.toDate());
      setUpcomingBookings(upcoming);
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

  // ── Calendar helpers ─────────────────────────────────────────
  const year        = currentMonth.getFullYear();
  const month       = currentMonth.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate   = new Date(); todayDate.setHours(0,0,0,0);

  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  const getIcalWindowsForDay = (day) =>
    availWindows.filter(w => w.start.toDateString() === day.toDateString());

  const getFirestoreWindowsForDay = (day) =>
    windows.filter(w => w.start.toDate().toDateString() === day.toDateString());

  const getPendingForDay = (day) => {
    const existing = new Set(
      getFirestoreWindowsForDay(day).map(w =>
        `${w.start.toDate().getTime()}-${w.end.toDate().getTime()}`
      )
    );
    return getIcalWindowsForDay(day).filter(
      w => !existing.has(`${w.start.getTime()}-${w.end.getTime()}`)
    );
  };

  const selectedIcalWindows      = selectedDate ? getIcalWindowsForDay(selectedDate)      : [];
  const selectedFirestoreWindows = selectedDate ? getFirestoreWindowsForDay(selectedDate)  : [];
  const selectedPending          = selectedDate ? getPendingForDay(selectedDate)            : [];

  // ── Import window to Firestore ───────────────────────────────
  const handleImportWindow = async (w) => {
    const docRef = await addDoc(collection(db, "windows"), {
      start: Timestamp.fromDate(w.start),
      end:   Timestamp.fromDate(w.end),
      summary: w.summary,
    });
    const newW = { id: docRef.id, start: Timestamp.fromDate(w.start), end: Timestamp.fromDate(w.end), summary: w.summary };
    setWindows(prev => [...prev, newW].sort((a,b) => a.start.toDate() - b.start.toDate()));
    showToast("✅ Window imported!");
  };

  const handleImportAll = async () => {
    const allPending = availWindows.filter(w => {
      const existing = new Set(
        getFirestoreWindowsForDay(w.start).map(fw =>
          `${fw.start.toDate().getTime()}-${fw.end.toDate().getTime()}`
        )
      );
      return !existing.has(`${w.start.getTime()}-${w.end.getTime()}`);
    });
    if (allPending.length === 0) return showToast("Nothing new to import", "error");
    for (const w of allPending) await handleImportWindow(w);
    showToast(`✅ ${allPending.length} windows imported!`);
  };

  const handleDeleteWindow = async (windowId) => {
    await confirm("Delete this availability window? Brothers won't be able to book it anymore.");
    await deleteDoc(doc(db, "windows", windowId));
    setWindows(prev => prev.filter(w => w.id !== windowId));
    showToast("Window removed.");
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
      start: b.startTime.toDate(),
      description: `Haircut with ${b.userName} (${b.userEmail})`,
    });
    const a = document.createElement("a");
    a.href = makeIcsDataUri(ics);
    a.download = `haircut-${b.userName.split(" ")[0].toLowerCase()}.ics`;
    a.click();
  };

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

  return (
    <div>
      {modal && (
        <ConfirmModal message={modal.message} onConfirm={modal.onConfirm} onCancel={() => setModal(null)} />
      )}

      <div className="section-header">
        <h2>⚙ Admin Panel</h2>
        <p>Manage your availability, brothers, and bookings</p>
      </div>

      <CalBadge />

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === "slots"    ? "active" : ""}`} onClick={() => setTab("slots")}>📅 Availability</button>
        <button className={`admin-tab ${tab === "brothers" ? "active" : ""}`} onClick={() => setTab("brothers")}>👥 Brothers</button>
        <button className={`admin-tab ${tab === "bookings" ? "active" : ""}`} onClick={() => setTab("bookings")}>📋 Upcoming</button>
      </div>

      {/* ── AVAILABILITY ── */}
      {tab === "slots" && (
        <div className="slot-manager">
          <div className="slot-form">
            <h3>📱 HOW IT WORKS</h3>
            <div className="ical-instructions">
              <strong>On your iPhone:</strong>
              <span>1. Open Calendar → create an event in <em>Barber Benjamin</em></span>
              <span>2. Name it <strong>Available</strong>, set the time window (e.g. 14:00–17:00)</span>
              <span>3. Refresh here → import → brothers can book any 1-hour slot within that window</span>
            </div>
            {calStatus === "loaded" && availWindows.length > 0 && (
              <button className="add-slot-btn" style={{marginTop:"1rem"}} onClick={handleImportAll}>
                ⬇ Import all {availWindows.length} window{availWindows.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Calendar */}
          <div className="slot-form">
            <h3>📅 YOUR CALENDAR</h3>
            <p style={{color:"var(--gray-light)", fontSize:"0.85rem", marginBottom:"1rem"}}>
              🟡 = unimported window · 🟢 dot = active availability · click a day for details
            </p>
            <div className="calendar-header">
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month-1, 1))}>‹</button>
              <span style={{fontWeight:600}}>{MONTHS[month]} {year}</span>
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month+1, 1))}>›</button>
            </div>
            <div className="cal-grid" style={{marginBottom:"1rem"}}>
              {DAYS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
              {calDays.map((day, i) => {
                if (!day) return <div key={i} className="cal-day empty" />;
                const isPast     = day < todayDate;
                const isToday    = day.toDateString() === todayDate.toDateString();
                const isSelected = selectedDate?.toDateString() === day.toDateString();
                const hasPending = !isPast && getPendingForDay(day).length > 0;
                const hasWindows = !isPast && getFirestoreWindowsForDay(day).length > 0;
                return (
                  <div key={i} onClick={() => setSelectedDate(day)}
                    className={["cal-day", isPast?"disabled":"", isToday?"today":"",
                      isSelected?"selected":"", hasPending?"has-pending": hasWindows?"has-free":"",
                    ].filter(Boolean).join(" ")}>
                    {day.getDate()}
                    {hasWindows && <div className="cal-dot" />}
                  </div>
                );
              })}
            </div>

            {selectedDate && (
              <div className="day-detail">
                <h4 className="day-detail-title">
                  {selectedDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })}
                </h4>

                {selectedPending.length > 0 && (
                  <div className="day-detail-section">
                    <span className="day-detail-label" style={{color:"var(--warning)"}}>🟡 Not yet imported</span>
                    {selectedPending.map((w, i) => (
                      <div key={i} className="day-event-row" style={{background:"rgba(230,126,34,0.1)"}}>
                        <span>
                          {w.start.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                          {" – "}
                          {w.end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                        </span>
                        <button className="import-window-btn" onClick={() => handleImportWindow(w)}>+ Import</button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedFirestoreWindows.length > 0 && (
                  <div className="day-detail-section">
                    <span className="day-detail-label free">🟢 Active availability</span>
                    {selectedFirestoreWindows.map(w => {
                      const dayBookings = bookings.filter(b =>
                        b.windowId === w.id
                      );
                      return (
                        <div key={w.id} className="day-event-row free" style={{flexDirection:"column", alignItems:"flex-start", gap:"0.4rem"}}>
                          <div style={{display:"flex", justifyContent:"space-between", width:"100%"}}>
                            <span style={{fontWeight:600}}>
                              {w.start.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                              {" – "}
                              {w.end.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                            </span>
                            <button className="delete-slot-btn" onClick={() => handleDeleteWindow(w.id)}>✕</button>
                          </div>
                          {dayBookings.length > 0 && (
                            <div style={{fontSize:"0.8rem", color:"var(--gray-light)"}}>
                              {dayBookings.map(b => (
                                <span key={b.id} className="slot-booked-badge" style={{marginRight:"0.4rem"}}>
                                  {b.startTime.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} {b.userName}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedIcalWindows.length === 0 && selectedFirestoreWindows.length === 0 && (
                  <p style={{color:"var(--gray-light)", fontSize:"0.85rem"}}>
                    Nothing here — add an "Available" event in Barber Benjamin on iPhone.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* All windows list */}
          <div className="existing-slots">
            <h3>ALL AVAILABILITY WINDOWS</h3>
            {windows.length === 0 ? (
              <p style={{color:"var(--gray-light)"}}>No windows yet.</p>
            ) : windows.map(w => {
              const d        = w.start.toDate();
              const isPast   = d < today;
              const dayBookings = bookings.filter(b => b.windowId === w.id);
              return (
                <div key={w.id} className="slot-row" style={isPast ? {opacity:0.4} : {}}>
                  <div className="slot-row-info">
                    <strong>{d.toLocaleDateString("en-GB", { weekday:"short", month:"short", day:"numeric" })}</strong>
                    <span>
                      {w.start.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      {" – "}
                      {w.end.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                    </span>
                    {dayBookings.length > 0 && (
                      <span className="slot-booked-badge" style={{marginLeft:"0.5rem"}}>
                        {dayBookings.length} booked
                      </span>
                    )}
                  </div>
                  {!isPast && (
                    <button className="delete-slot-btn" onClick={() => handleDeleteWindow(w.id)}>✕</button>
                  )}
                </div>
              );
            })}
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

      {/* ── UPCOMING ── */}
      {tab === "bookings" && (
        <div className="upcoming-bookings">
          {upcomingBookings.length === 0 ? (
            <div className="empty-state"><div className="big-icon">📭</div><p>No upcoming bookings.</p></div>
          ) : upcomingBookings.map(b => (
            <div key={b.id} className="admin-booking-card">
              <div>
                <div className="who">{b.userName}</div>
                <div className="when">
                  {b.startTime.toDate().toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })} at {b.startTime.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
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
