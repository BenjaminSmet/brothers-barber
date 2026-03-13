import { useState, useEffect, useCallback } from "react";
import { db, storage } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, Timestamp, where, updateDoc
} from "firebase/firestore";
import { generateIcs, makeIcsDataUri, notifyBrotherConfirmed, notifyBrotherDenied, notifyCancellation } from "../utils/emailAndCalendar";

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
  const [tab, setTab] = useState("requests");

  const [windows, setWindows]           = useState([]);
  const [availWindows, setAvailWindows] = useState([]);
  const [calStatus, setCalStatus]       = useState("idle");
  const [calSummary, setCalSummary]     = useState("");

  const [pendingBookings, setPendingBookings]     = useState([]);
  const [confirmedBookings, setConfirmedBookings] = useState([]);
  const [allBookings, setAllBookings]             = useState([]);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName]   = useState("");
  const [users, setUsers]       = useState([]);

  const [modal, setModal]   = useState(null);
  const [toast, setToast]   = useState(null);
  const [photoModal, setPhotoModal] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const confirm = (message) =>
    new Promise((resolve) => {
      setModal({ message, onConfirm: () => { setModal(null); resolve(true); } });
    });

  // ── iCal ────────────────────────────────────────────────────
  const fetchCalendar = useCallback(async () => {
    if (!ICAL_BARBER) return;
    setCalStatus("loading");
    try {
      const text   = await fetchIcal(ICAL_BARBER);
      const parsed = parseAvailability(text);
      setAvailWindows(parsed);
      setCalStatus("loaded");
      setCalSummary(`${parsed.length} window${parsed.length !== 1 ? "s" : ""} found`);
    } catch (err) {
      setCalStatus("error");
    }
  }, []);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  // ── Load data ────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(query(collection(db, "windows")));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a,b) => a.start.toDate() - b.start.toDate());
      setWindows(list);
    };
    load();
  }, []);

  const loadBookings = useCallback(async () => {
    const snap = await getDocs(collection(db, "bookings"));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a,b) => a.startTime.toDate() - b.startTime.toDate());
    setAllBookings(list);
    setPendingBookings(list.filter(b => b.status === "pending" && b.startTime.toDate() >= new Date()));
    setConfirmedBookings(list.filter(b => b.status === "confirmed" && b.startTime.toDate() >= new Date()));
  }, []);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "allowedUsers"));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setUsers(list);
    };
    load();
  }, []);

  // ── Approve / Deny ───────────────────────────────────────────
  const handleApprove = async (booking) => {
    await updateDoc(doc(db, "bookings", booking.id), { status: "confirmed" });
    try {
      await notifyBrotherConfirmed({
        userName:  booking.userName,
        userEmail: booking.userEmail,
        slotDate:  booking.startTime.toDate(),
        slotTime:  booking.slotTime,
      });
    } catch (e) { console.warn("Email failed:", e); }
    showToast(`✅ Confirmed for ${booking.userName}!`);
    loadBookings();
  };

  const handleDeny = async (booking) => {
    await updateDoc(doc(db, "bookings", booking.id), { status: "denied" });
    try {
      await notifyBrotherDenied({
        userName:  booking.userName,
        userEmail: booking.userEmail,
        slotDate:  booking.startTime.toDate(),
        slotTime:  booking.slotTime,
      });
    } catch (e) { console.warn("Email failed:", e); }
    showToast(`Denied & notified ${booking.userName}.`);
    loadBookings();
  };

  const handleCancelConfirmed = async (booking) => {
    await confirm(`Cancel ${booking.userName}'s booking?`);
    await updateDoc(doc(db, "bookings", booking.id), { status: "cancelled" });
    try {
      await notifyCancellation({
        userName: booking.userName, userEmail: booking.userEmail,
        slotDate: booking.startTime.toDate(), slotTime: booking.slotTime,
        cancelledByAdmin: true,
      });
    } catch (e) { console.warn("Email failed:", e); }
    showToast("Booking cancelled.");
    loadBookings();
  };

  // ── Calendar / windows ───────────────────────────────────────
  const year = currentMonth.getFullYear(), month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  const getIcalWindowsForDay  = (day) => availWindows.filter(w => w.start.toDateString() === day.toDateString());
  const getFirestoreWindowsForDay = (day) => windows.filter(w => w.start.toDate().toDateString() === day.toDateString());
  const getPendingForDay = (day) => {
    const existing = new Set(getFirestoreWindowsForDay(day).map(w => `${w.start.toDate().getTime()}-${w.end.toDate().getTime()}`));
    return getIcalWindowsForDay(day).filter(w => !existing.has(`${w.start.getTime()}-${w.end.getTime()}`));
  };

  const selectedPending          = selectedDate ? getPendingForDay(selectedDate)           : [];
  const selectedFirestoreWindows = selectedDate ? getFirestoreWindowsForDay(selectedDate)  : [];
  const selectedIcalWindows      = selectedDate ? getIcalWindowsForDay(selectedDate)       : [];

  const handleImportWindow = async (w) => {
    const docRef = await addDoc(collection(db, "windows"), {
      start: Timestamp.fromDate(w.start), end: Timestamp.fromDate(w.end), summary: w.summary,
    });
    setWindows(prev => [...prev, { id: docRef.id, start: Timestamp.fromDate(w.start), end: Timestamp.fromDate(w.end), summary: w.summary }]
      .sort((a,b) => a.start.toDate() - b.start.toDate()));
    showToast("✅ Window imported!");
  };

  const handleImportAll = async () => {
    const allPending = availWindows.filter(w => {
      const existing = new Set(getFirestoreWindowsForDay(w.start).map(fw => `${fw.start.toDate().getTime()}-${fw.end.toDate().getTime()}`));
      return !existing.has(`${w.start.getTime()}-${w.end.getTime()}`);
    });
    if (allPending.length === 0) return showToast("Nothing new to import", "error");
    for (const w of allPending) await handleImportWindow(w);
  };

  const handleDeleteWindow = async (windowId) => {
    await confirm("Delete this availability window?");
    await deleteDoc(doc(db, "windows", windowId));
    setWindows(prev => prev.filter(w => w.id !== windowId));
    showToast("Window removed.");
  };

  const handleAddUser = async () => {
    if (!newEmail) return showToast("Enter an email", "error");
    const docRef = await addDoc(collection(db, "allowedUsers"), {
      email: newEmail.trim().toLowerCase(), name: newName.trim(), addedAt: Timestamp.now(),
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

  const handleAddToCalendar = (b) => {
    const ics = generateIcs({ title: `✂️ Haircut — ${b.userName}`, start: b.startTime.toDate(), description: `Haircut with ${b.userName}` });
    const a = document.createElement("a");
    a.href = makeIcsDataUri(ics);
    a.download = `haircut-${b.userName.split(" ")[0].toLowerCase()}.ics`;
    a.click();
  };

  const CalBadge = () => {
    if (calStatus === "loading") return <div className="cal-badge loading">⏳ Reading calendar...</div>;
    if (calStatus === "loaded")  return <div className="cal-badge loaded" style={{cursor:"pointer"}} onClick={fetchCalendar}>✅ {calSummary} · <span style={{opacity:0.6}}>refresh</span></div>;
    if (calStatus === "error")   return <div className="cal-badge error"  style={{cursor:"pointer"}} onClick={fetchCalendar}>⚠️ Could not read calendar · retry</div>;
    return null;
  };

  const today = new Date(); today.setHours(0,0,0,0);

  const fmt = (dt) => dt.toLocaleDateString("en-GB", { weekday:"short", month:"short", day:"numeric" });
  const fmtTime = (dt) => dt.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  return (
    <div>
      {modal && <ConfirmModal message={modal.message} onConfirm={modal.onConfirm} onCancel={() => setModal(null)} />}

      {/* Photo modal */}
      {photoModal && (
        <div className="modal-backdrop" onClick={() => setPhotoModal(null)}>
          <div className="photo-modal-box" onClick={e => e.stopPropagation()}>
            <button className="photo-modal-close" onClick={() => setPhotoModal(null)}>✕</button>
            <img src={photoModal} alt="Haircut reference" style={{width:"100%", borderRadius:"12px", maxHeight:"80vh", objectFit:"contain"}} />
          </div>
        </div>
      )}

      <div className="section-header">
        <h2>⚙ Admin Panel</h2>
        <p>Manage requests, availability, brothers</p>
      </div>

      <CalBadge />

      <div className="admin-tabs">
        <button className={`admin-tab ${tab==="requests"  ? "active":""}`} onClick={() => setTab("requests")}>
          📬 Requests {pendingBookings.length > 0 && <span className="tab-badge">{pendingBookings.length}</span>}
        </button>
        <button className={`admin-tab ${tab==="confirmed" ? "active":""}`} onClick={() => setTab("confirmed")}>📋 Confirmed</button>
        <button className={`admin-tab ${tab==="slots"     ? "active":""}`} onClick={() => setTab("slots")}>📅 Availability</button>
        <button className={`admin-tab ${tab==="brothers"  ? "active":""}`} onClick={() => setTab("brothers")}>👥 Brothers</button>
      </div>

      {/* ── REQUESTS ── */}
      {tab === "requests" && (
        <div className="upcoming-bookings">
          {pendingBookings.length === 0 ? (
            <div className="empty-state"><div className="big-icon">📭</div><p>No pending requests.</p></div>
          ) : pendingBookings.map(b => (
            <div key={b.id} className="admin-booking-card pending-card">
              <div style={{flex:1}}>
                <div className="who">{b.userName}</div>
                <div className="when">{fmt(b.startTime.toDate())} at {fmtTime(b.startTime.toDate())}</div>
                <small style={{color:"var(--gray-light)"}}>{b.userEmail}</small>
              </div>
              <div style={{display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"0.5rem"}}>
                {b.photoUrl && (
                  <button className="view-photo-btn" onClick={() => setPhotoModal(b.photoUrl)}>
                    📸 View photo
                  </button>
                )}
                <div style={{display:"flex", gap:"0.5rem"}}>
                  <button className="deny-btn"    onClick={() => handleDeny(b)}>✕ Deny</button>
                  <button className="approve-btn" onClick={() => handleApprove(b)}>✓ Approve</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CONFIRMED ── */}
      {tab === "confirmed" && (
        <div className="upcoming-bookings">
          {confirmedBookings.length === 0 ? (
            <div className="empty-state"><div className="big-icon">📭</div><p>No confirmed bookings.</p></div>
          ) : confirmedBookings.map(b => (
            <div key={b.id} className="admin-booking-card">
              <div style={{flex:1}}>
                <div className="who">{b.userName}</div>
                <div className="when">{fmt(b.startTime.toDate())} at {fmtTime(b.startTime.toDate())}</div>
                <small style={{color:"var(--gray-light)"}}>{b.userEmail}</small>
              </div>
              <div style={{display:"flex", alignItems:"center", gap:"0.5rem"}}>
                {b.photoUrl && <button className="view-photo-btn" onClick={() => setPhotoModal(b.photoUrl)}>📸</button>}
                <button className="cal-mini-btn" onClick={() => handleAddToCalendar(b)}>📅</button>
                <button className="deny-btn" onClick={() => handleCancelConfirmed(b)}>Cancel</button>
                <span className="admin-badge">CONFIRMED</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── AVAILABILITY ── */}
      {tab === "slots" && (
        <div className="slot-manager">
          <div className="slot-form">
            <h3>📱 HOW IT WORKS</h3>
            <div className="ical-instructions">
              <strong>On your iPhone:</strong>
              <span>1. Create an event named <strong>Available</strong> in Barber Benjamin calendar</span>
              <span>2. Set the time window (e.g. 14:00–17:00)</span>
              <span>3. Refresh here → import → brothers can request any 1-hour slot</span>
            </div>
            {calStatus === "loaded" && availWindows.length > 0 && (
              <button className="add-slot-btn" style={{marginTop:"1rem"}} onClick={handleImportAll}>
                ⬇ Import all {availWindows.length} window{availWindows.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          <div className="slot-form">
            <h3>📅 YOUR CALENDAR</h3>
            <div className="calendar-header">
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month-1, 1))}>‹</button>
              <span style={{fontWeight:600}}>{MONTHS[month]} {year}</span>
              <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month+1, 1))}>›</button>
            </div>
            <div className="cal-grid" style={{marginBottom:"1rem"}}>
              {DAYS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
              {calDays.map((day, i) => {
                if (!day) return <div key={i} className="cal-day empty" />;
                const isPast = day < todayDate;
                const isToday = day.toDateString() === todayDate.toDateString();
                const isSelected = selectedDate?.toDateString() === day.toDateString();
                const hasPending = !isPast && getPendingForDay(day).length > 0;
                const hasWindows = !isPast && getFirestoreWindowsForDay(day).length > 0;
                return (
                  <div key={i} onClick={() => setSelectedDate(day)}
                    className={["cal-day", isPast?"disabled":"", isToday?"today":"", isSelected?"selected":"",
                      hasPending?"has-pending": hasWindows?"has-free":""].filter(Boolean).join(" ")}>
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
                        <span>{fmtTime(w.start)} – {fmtTime(w.end)}</span>
                        <button className="import-window-btn" onClick={() => handleImportWindow(w)}>+ Import</button>
                      </div>
                    ))}
                  </div>
                )}
                {selectedFirestoreWindows.length > 0 && (
                  <div className="day-detail-section">
                    <span className="day-detail-label free">🟢 Active</span>
                    {selectedFirestoreWindows.map(w => {
                      const dayBookings = allBookings.filter(b => b.windowId === w.id && b.status === "confirmed");
                      return (
                        <div key={w.id} className="day-event-row free" style={{flexDirection:"column", alignItems:"flex-start", gap:"0.4rem"}}>
                          <div style={{display:"flex", justifyContent:"space-between", width:"100%"}}>
                            <span style={{fontWeight:600}}>{fmtTime(w.start.toDate())} – {fmtTime(w.end.toDate())}</span>
                            <button className="delete-slot-btn" onClick={() => handleDeleteWindow(w.id)}>✕</button>
                          </div>
                          {dayBookings.length > 0 && (
                            <div style={{fontSize:"0.8rem", color:"var(--gray-light)"}}>
                              {dayBookings.map(b => (
                                <span key={b.id} className="slot-booked-badge" style={{marginRight:"0.4rem"}}>
                                  {fmtTime(b.startTime.toDate())} {b.userName}
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
                  <p style={{color:"var(--gray-light)", fontSize:"0.85rem"}}>Nothing here yet.</p>
                )}
              </div>
            )}
          </div>

          <div className="existing-slots">
            <h3>ALL WINDOWS</h3>
            {windows.length === 0 ? <p style={{color:"var(--gray-light)"}}>No windows yet.</p>
            : windows.map(w => {
              const d = w.start.toDate();
              const isPast = d < today;
              const dayBookings = allBookings.filter(b => b.windowId === w.id && b.status === "confirmed");
              return (
                <div key={w.id} className="slot-row" style={isPast ? {opacity:0.4} : {}}>
                  <div className="slot-row-info">
                    <strong>{fmt(d)}</strong>
                    <span>{fmtTime(w.start.toDate())} – {fmtTime(w.end.toDate())}</span>
                    {dayBookings.length > 0 && <span className="slot-booked-badge" style={{marginLeft:"0.5rem"}}>{dayBookings.length} booked</span>}
                  </div>
                  {!isPast && <button className="delete-slot-btn" onClick={() => handleDeleteWindow(w.id)}>✕</button>}
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
              <input type="email" placeholder="brother@gmail.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Name (optional)</label>
              <input type="text" placeholder="e.g. Rayan" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <button className="add-user-btn" onClick={handleAddUser}>+ Add Brother</button>
          </div>
          <div className="users-list">
            {users.length === 0 ? <p style={{color:"var(--gray-light)"}}>No brothers yet.</p>
            : users.map(u => (
              <div key={u.id} className="user-row">
                <div className="user-row-info">
                  <strong>{u.name || "—"}</strong><small>{u.email}</small>
                </div>
                <button className="delete-slot-btn" onClick={() => handleRemoveUser(u.id, u.name)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
