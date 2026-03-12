import { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, Timestamp, where
} from "firebase/firestore";

// Parse iCal text and return busy time blocks
function parseIcal(text) {
  const events = [];
  const eventBlocks = text.split("BEGIN:VEVENT").slice(1);
  for (const block of eventBlocks) {
    const summary = (block.match(/SUMMARY:(.+)/) || [])[1]?.trim() || "Busy";
    // Handle DTSTART with or without TZID
    const dtStartRaw =
      (block.match(/DTSTART;[^:]+:(\d+T\d+)/) || [])[1] ||
      (block.match(/DTSTART:(\d+T\d+)/) || [])[1];
    const dtEndRaw =
      (block.match(/DTEND;[^:]+:(\d+T\d+)/) || [])[1] ||
      (block.match(/DTEND:(\d+T\d+)/) || [])[1];
    if (!dtStartRaw || !dtEndRaw) continue;
    const parse = (s) => {
      // 20250315T140000 → Date
      const y = +s.slice(0,4), mo = +s.slice(4,6)-1, d = +s.slice(6,8);
      const h = +s.slice(9,11), m = +s.slice(11,13);
      return new Date(y, mo, d, h, m);
    };
    events.push({ summary, start: parse(dtStartRaw), end: parse(dtEndRaw) });
  }
  return events;
}

// Generate 30-min slots within a free window, skipping busy times
function generateSlots(date, fromTime, toTime, busyEvents) {
  const [fh, fm] = fromTime.split(":").map(Number);
  const [th, tm] = toTime.split(":").map(Number);
  const slots = [];
  let cur = new Date(date);
  cur.setHours(fh, fm, 0, 0);
  const end = new Date(date);
  end.setHours(th, tm, 0, 0);

  while (cur < end) {
    const slotEnd = new Date(cur.getTime() + 30 * 60000);
    // Check if this 30-min window overlaps with any busy event
    const isBusy = busyEvents.some(ev => {
      const evDate = ev.start.toDateString();
      const slotDate = cur.toDateString();
      if (evDate !== slotDate) return false;
      return cur < ev.end && slotEnd > ev.start;
    });
    if (!isBusy) {
      slots.push(new Date(cur));
    }
    cur = slotEnd;
  }
  return slots;
}

export default function AdminPanel({ adminEmail }) {
  const [tab, setTab] = useState("slots");

  // Slots state
  const [slotDate, setSlotDate] = useState("");
  const [fromTime, setFromTime] = useState("09:00");
  const [toTime, setToTime] = useState("17:00");
  const [slots, setSlots] = useState([]);
  const [bookedSet, setBookedSet] = useState(new Set());

  // iCal state
  const [busyEvents, setBusyEvents] = useState([]);
  const [icalLoaded, setIcalLoaded] = useState(false);
  const fileInputRef = useRef();

  // Whitelist state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [users, setUsers] = useState([]);

  // Upcoming bookings
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load slots
  useEffect(() => {
    const fetchSlots = async () => {
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
    fetchSlots();
  }, []);

  // Load users
  useEffect(() => {
    const fetchUsers = async () => {
      const snap = await getDocs(collection(db, "allowedUsers"));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setUsers(list);
    };
    fetchUsers();
  }, []);

  // Load upcoming bookings
  useEffect(() => {
    const fetchBookings = async () => {
      const now = Timestamp.fromDate(new Date());
      const snap = await getDocs(query(collection(db, "bookings"), where("slotDate", ">=", now)));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.slotDate.toDate() - b.slotDate.toDate());
      setUpcomingBookings(list);
    };
    fetchBookings();
  }, []);

  // Handle iCal file upload
  const handleIcalUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const events = parseIcal(ev.target.result);
      setBusyEvents(events);
      setIcalLoaded(true);
      showToast(`✅ Calendar loaded — ${events.length} events found`);
    };
    reader.readAsText(file);
  };

  // Preview what slots would be generated
  const previewSlots = () => {
    if (!slotDate || !fromTime || !toTime) return [];
    return generateSlots(new Date(slotDate + "T00:00"), fromTime, toTime, busyEvents);
  };

  const preview = previewSlots();

  // Add all preview slots to Firestore
  const handleAddSlots = async () => {
    if (!slotDate || !fromTime || !toTime) return showToast("Fill in date and times", "error");
    if (preview.length === 0) return showToast("No free slots in this window", "error");

    const newSlots = [];
    for (const dt of preview) {
      const label = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const docRef = await addDoc(collection(db, "slots"), {
        datetime: Timestamp.fromDate(dt),
        label,
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

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div>
      <div className="section-header">
        <h2>⚙ Admin Panel</h2>
        <p>Manage your availability, brothers, and bookings</p>
      </div>

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

      {/* SLOTS */}
      {tab === "slots" && (
        <div className="slot-manager">

          {/* iCal import */}
          <div className="slot-form">
            <h3>📱 IMPORT FROM iPHONE CALENDAR</h3>
            <p style={{color:"var(--gray-light)", fontSize:"0.85rem", marginBottom:"1rem"}}>
              Export your calendar from iPhone as a .ics file, then upload it here. Your busy times will be automatically skipped when generating slots.
            </p>
            <div style={{display:"flex", alignItems:"center", gap:"1rem", flexWrap:"wrap"}}>
              <button className="add-slot-btn" style={{margin:0}} onClick={() => fileInputRef.current.click()}>
                📂 Upload .ics file
              </button>
              <input ref={fileInputRef} type="file" accept=".ics" style={{display:"none"}} onChange={handleIcalUpload} />
              {icalLoaded && (
                <span style={{color:"var(--success)", fontSize:"0.85rem", fontWeight:600}}>
                  ✓ Calendar loaded — busy times will be skipped
                </span>
              )}
            </div>
            <div className="ical-instructions">
              <strong>How to export from iPhone:</strong>
              <span>Open a calendar app on Mac → File → Export → Export... → save as .ics</span>
              <span>Or use <em>iCloud.com</em> → Calendar → select calendar → export</span>
            </div>
          </div>

          {/* Time range form */}
          <div className="slot-form">
            <h3>ADD AVAILABLE TIME WINDOW</h3>
            <p style={{color:"var(--gray-light)", fontSize:"0.85rem", marginBottom:"1rem"}}>
              Set a date and your free window. Slots are generated every 30 minutes{icalLoaded ? ", skipping your busy calendar events" : ""}.
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
                    ? "⚠️ No free slots in this window"
                    : `Preview — ${preview.length} slots:`}
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
              + Add {preview.length > 0 ? `${preview.length} Slots` : "Slots"}
            </button>
          </div>

          <div className="existing-slots">
            <h3>EXISTING SLOTS</h3>
            {slots.length === 0 ? (
              <p style={{color:"var(--gray-light)"}}>No slots yet. Add some above!</p>
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

      {/* BROTHERS / WHITELIST */}
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
              <input type="text" placeholder="e.g. Ahmed"
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
                <button className="delete-slot-btn" onClick={() => handleRemoveUser(u.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* UPCOMING BOOKINGS */}
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
              <span className="admin-badge">BOOKED</span>
            </div>
          ))}
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
