import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, Timestamp, where
} from "firebase/firestore";

export default function AdminPanel({ adminEmail }) {
  const [tab, setTab] = useState("slots");

  // Slots state
  const [slotDate, setSlotDate] = useState("");
  const [slotTime, setSlotTime] = useState("");
  const [slots, setSlots] = useState([]);
  const [bookedSet, setBookedSet] = useState(new Set());

  // Whitelist state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [users, setUsers] = useState([]);

  // Upcoming bookings
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load slots
  useEffect(() => {
    const fetchSlots = async () => {
      const q = query(collection(db, "slots"), orderBy("datetime", "asc"));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setSlots(list);

      // Which are booked?
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
      const q = query(
        collection(db, "bookings"),
        where("slotDate", ">=", Timestamp.fromDate(new Date())),
        orderBy("slotDate", "asc")
      );
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setUpcomingBookings(list);
    };
    fetchBookings();
  }, []);

  const handleAddSlot = async () => {
    if (!slotDate || !slotTime) return showToast("Pick a date and time", "error");
    const datetime = new Date(`${slotDate}T${slotTime}`);
    const label = datetime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const docRef = await addDoc(collection(db, "slots"), {
      datetime: Timestamp.fromDate(datetime),
      label,
    });
    setSlots(prev => [...prev, { id: docRef.id, datetime: Timestamp.fromDate(datetime), label }]
      .sort((a, b) => a.datetime.toDate() - b.datetime.toDate()));
    setSlotDate(""); setSlotTime("");
    showToast("✅ Slot added!");
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
          <div className="slot-form">
            <h3>ADD A NEW SLOT</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={slotDate} onChange={e => setSlotDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]} />
              </div>
              <div className="form-group">
                <label>Time</label>
                <input type="time" value={slotTime} onChange={e => setSlotTime(e.target.value)} />
              </div>
            </div>
            <button className="add-slot-btn" onClick={handleAddSlot}>+ Add Slot</button>
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
              <input
                type="email" placeholder="brother@gmail.com"
                value={newEmail} onChange={e => setNewEmail(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Name (optional)</label>
              <input
                type="text" placeholder="e.g. Ahmed"
                value={newName} onChange={e => setNewName(e.target.value)}
              />
            </div>
            <button className="add-user-btn" onClick={handleAddUser}>+ Add Brother</button>
          </div>

          <div className="users-list">
            {users.length === 0 ? (
              <p style={{color:"var(--gray-light)"}}>No brothers added yet.</p>
            ) : (
              users.map(u => (
                <div key={u.id} className="user-row">
                  <div className="user-row-info">
                    <strong>{u.name || "—"}</strong>
                    <small>{u.email}</small>
                  </div>
                  <button className="delete-slot-btn" onClick={() => handleRemoveUser(u.id)}>✕</button>
                </div>
              ))
            )}
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
          ) : (
            upcomingBookings.map(b => (
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
            ))
          )}
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
