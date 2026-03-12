import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, Timestamp, where
} from "firebase/firestore";
import { generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

const CORS_PROXY = process.env.REACT_APP_CORS_PROXY;
const ICAL_PRIVE = process.env.REACT_APP_ICAL_PRIVE;
const ICAL_WERK = process.env.REACT_APP_ICAL_WERK;

// ── iCal parser ───────────────────────────────────────────────
function parseIcal(text) {
  const events = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const summary = (block.match(/SUMMARY:(.+)/) || [])[1]?.trim() || "Busy";

    // Handle all DTSTART/DTEND variants: with TZID, with Z (UTC), or plain local
    const parseRaw = (raw) => {
      if (!raw) return null;
      // Strip any trailing Z or timezone info for simple local parse
      const clean = raw.replace(/Z$/, "");
      const isUtc = raw.endsWith("Z");
      const y  = +clean.slice(0, 4);
      const mo = +clean.slice(4, 6) - 1;
      const d  = +clean.slice(6, 8);
      const h  = clean.length > 8 ? +clean.slice(9, 11) : 0;
      const m  = clean.length > 8 ? +clean.slice(11, 13) : 0;
      return isUtc ? new Date(Date.UTC(y, mo, d, h, m)) : new Date(y, mo, d, h, m);
    };

    const dtStartRaw =
      (block.match(/DTSTART(?:;[^:]+)?:(\d+(?:T\d+)?Z?)/) || [])[1];
    const dtEndRaw =
      (block.match(/DTEND(?:;[^:]+)?:(\d+(?:T\d+)?Z?)/) || [])[1];

    const start = parseRaw(dtStartRaw);
    const end   = parseRaw(dtEndRaw);
    if (!start || !end) continue;

    // Skip all-day events that span more than 2 days (holidays/vacations are fine to keep)
    events.push({ summary, start, end });
  }
  return events;
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

// ── Component ─────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab, setTab] = useState("slots");

  // Slots
  const [slotDate, setSlotDate]   = useState("");
  const [fromTime, setFromTime]   = useState("09:00");
  const [toTime, setToTime]       = useState("17:00");
  const [slots, setSlots]         = useState([]);
  const [bookedSet, setBookedSet] = useState(new Set());

  // iCal
  const [busyEvents, setBusyEvents]       = useState([]);
  const [calStatus, setCalStatus]         = useState("idle"); // idle | loading | loaded | error
  const [calSummary, setCalSummary]       = useState("");

  // Brothers
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName]   = useState("");
  const [users, setUsers]       = useState([]);

  // Upcoming bookings
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Auto-fetch iCal calendars on mount ───────────────────────
  useEffect(() => {
    const fetchCalendars = async () => {
      if (!ICAL_PRIVE && !ICAL_WERK) return;
      setCalStatus("loading");
      try {
        const fetches = [];
        if (ICAL_PRIVE) fetches.push(fetch(CORS_PROXY + encodeURIComponent(ICAL_PRIVE)).then(r => r.text()));
        if (ICAL_WERK)  fetches.push(fetch(CORS_PROXY + encodeURIComponent(ICAL_WERK)).then(r => r.text()));
        const texts = await Promise.all(fetches);
        const allEvents = texts.flatMap(parseIcal);
        setBusyEvents(allEvents);
        setCalStatus("loaded");
        const names = [ICAL_PRIVE && "Privé", ICAL_WERK && "Werk"].filter(Boolean).join(" + ");
        setCalSummary(`${names} — ${allEvents.length} events loaded`);
      } catch (err) {
        console.error("iCal fetch failed:", err);
        setCalStatus("error");
      }
    };
    fetchCalendars();
  }, []);

  // ── Load slots + booked set ──────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      const snap = await getDocs(query(collection(db, "slots")));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.datetime.toDate() - b.datetime.toDate());
      setSlots(list);
      const bsnap = await getDocs(collection(db, "bookings"));
      const booked = new Set();
      bsnap.forEach(d => booked.add(d.data().slotId));
      setBookedSet(booked);
    };
    fetch_();
  }, []);

  // ── Load brothers ────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      const snap = await getDocs(collection(db, "allowedUsers"));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setUsers(list);
    };
    fetch_();
  }, []);

  // ── Load upcoming bookings ───────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      const now = Timestamp.fromDate(new Date());
      const snap = await getDocs(query(collection(db, "bookings"), where("slotDate", ">=", now)));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.slotDate.toDate() - b.slotDate.toDate());
      setUpcomingBookings(list);
    };
    fetch_();
  }, []);

  // ── Slot preview ─────────────────────────────────────────────
  const preview = (slotDate && fromTime && toTime)
    ? generateSlots(new Date(slotDate + "T00:00"), fromTime, toTime, busyEvents)
    : [];

  // How many preview slots are blocked by calendar
  const totalPossible = (slotDate && fromTime && toTime)
    ? generateSlots(new Date(slotDate + "T00:00"), fromTime, toTime, []).length
    : 0;
  const blockedCount = totalPossible - preview.length;

  // ── Add slots ────────────────────────────────────────────────
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

  const handleDeleteSlot = async (slotId) => {
    if (!window.confirm("Delete this slot?")) return;
    await deleteDoc(doc(db, "slots", slotId));
    setSlots(prev => prev.filter(s => s.id !== slotId));
    showToast("Slot removed.");
  };

  // ── Brothers ─────────────────────────────────────────────────
  const handleAddUser = async () => {
    if (!newEmail) return showToast("Enter an email", "error");
    await addDoc(collection(db, "allowedUsers"), {
      email: newEmail.trim().toLowerCase(),
      name: newName.trim(),
      addedAt: Timestamp.now(),
    });
    setUsers(prev => [...prev, { id: newEmail, email: newEmail, name: newName }]);
    setNewEmail(""); setNewName("");
    showToast("✅ Brother added!");
  };

  const handleRemoveUser = async (userId) => {
    if (!window.confirm("Remove this user?")) return;
    await deleteDoc(doc(db, "allowedUsers", userId));
    setUsers(prev => prev.filter(u => u.id !== userId));
    showToast("User removed.");
  };

  // ── Add booking to your calendar ─────────────────────────────
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

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // ── Calendar status badge ─────────────────────────────────────
  const CalBadge = () => {
    if (calStatus === "loading") return (
      <div className="cal-badge loading">⏳ Syncing calendars...</div>
    );
    if (calStatus === "loaded") return (
      <div className="cal-badge loaded">✅ {calSummary}</div>
    );
    if (calStatus === "error") return (
      <div className="cal-badge error">⚠️ Could not load calendars — busy times won't be blocked</div>
    );
    return null;
  };

  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="section-header">
        <h2>⚙ Admin Panel</h2>
        <p>Manage your availability, brothers, and bookings</p>
      </div>

      <CalBadge />

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === "slots" ? "active" : ""}`} onClick={() => setTab("slots")}>
          📅 Manage Slots
        </button>
        <button className={`admin-tab ${tab === "brothers" ? "active" : ""}`} onClick={() => setTab("brothers")}>
          👥 Brothers
        </button>
        <button className={`admin-tab ${tab === "bookings" ? "active" : ""}`} onClick={() => setTab("bookings")}>
          📋 Upcoming Bookings
        </button>
      </div>

      {/* ── SLOTS ── */}
      {tab === "slots" && (
        <div className="slot-manager">
          <div className="slot-form">
            <h3>ADD AVAILABLE TIME WINDOW</h3>
            <p style={{ color: "var(--gray-light)", fontSize: "0.85rem", marginBottom: "1rem" }}>
              Set a date and your free window. Slots are generated every 30 minutes
              {calStatus === "loaded" ? ", with your Privé + Werk calendar busy times automatically blocked" : ""}.
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

            {/* Preview */}
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

          <div className="existing-slots">
            <h3>EXISTING SLOTS</h3>
            {slots.length === 0 ? (
              <p style={{ color: "var(--gray-light)" }}>No slots yet. Add some above!</p>
            ) : (
              <div className="slots-table">
                {slots.map(slot => {
                  const d = slot.datetime.toDate();
                  const isPast = d < today;
                  const isBooked = bookedSet.has(slot.id);
                  return (
                    <div key={slot.id} className="slot-row" style={isPast ? { opacity: 0.4 } : {}}>
                      <div className="slot-row-info">
                        <strong>{d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" })}</strong>
                        <span>{slot.label}</span>
                        {isBooked && <span className="slot-booked-badge" style={{ marginLeft: "0.75rem" }}>BOOKED</span>}
                      </div>
                      {!isBooked && (
                        <button className="delete-slot-btn" onClick={() => handleDeleteSlot(slot.id)}>✕</button>
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
              <p style={{ color: "var(--gray-light)" }}>No brothers added yet.</p>
            ) : users.map(u => (
              <div key={u.id} className="user-row">
                <div className="user-row-info">
                  <strong>{u.name || "—"}</strong>
                  <small>{u.email}</small>
                </div>
                <button className="delete-slot-btn" onClick={() => handleRemoveUser(u.id)}>✕</button>
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
                  {b.slotDate.toDate().toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" })} at {b.slotTime}
                </div>
                <small style={{ color: "var(--gray-light)", fontSize: "0.75rem" }}>{b.userEmail}</small>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <button className="cal-mini-btn" onClick={() => handleAddBookingToCalendar(b)} title="Add to my calendar">
                  📅
                </button>
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
