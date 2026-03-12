import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection, query, where, getDocs, deleteDoc, doc
} from "firebase/firestore";

export default function MyBookings({ user }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const fetchBookings = async () => {
      const q = query(
        collection(db, "bookings"),
        where("userId", "==", user.uid)
      );
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.slotDate.toDate() - b.slotDate.toDate());
      setBookings(list);
      setLoading(false);
    };
    fetchBookings();
  }, [user.uid]);

  const handleCancel = async (bookingId) => {
    if (!window.confirm("Cancel this booking?")) return;
    await deleteDoc(doc(db, "bookings", bookingId));
    setBookings(prev => prev.filter(b => b.id !== bookingId));
    showToast("Booking cancelled.");
  };

  const now = new Date();

  const upcoming = bookings.filter(b => b.slotDate.toDate() >= now);
  const past = bookings.filter(b => b.slotDate.toDate() < now);

  if (loading) return <div className="empty-state"><div className="big-icon">⏳</div><p>Loading...</p></div>;

  return (
    <div>
      <div className="section-header">
        <h2>📋 My Bookings</h2>
        <p>Your upcoming and past haircut appointments</p>
      </div>

      {upcoming.length === 0 && past.length === 0 ? (
        <div className="empty-state">
          <div className="big-icon">✂️</div>
          <p>No bookings yet. Go book your next cut!</p>
        </div>
      ) : (
        <div className="bookings-list">
          {upcoming.length > 0 && (
            <>
              <h3 style={{fontFamily:"'Bebas Neue', sans-serif", letterSpacing:"2px", marginBottom:"0.5rem"}}>UPCOMING</h3>
              {upcoming.map(b => (
                <div key={b.id} className="booking-item">
                  <div className="booking-info">
                    <h4>{b.slotDate.toDate().toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" })}</h4>
                    <p>⏰ {b.slotTime || b.slotDate.toDate().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</p>
                  </div>
                  <div style={{display:"flex", alignItems:"center", gap:"0.75rem"}}>
                    <span className="booking-status status-upcoming">Upcoming</span>
                    <button className="cancel-btn" onClick={() => handleCancel(b.id)}>Cancel</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {past.length > 0 && (
            <>
              <h3 style={{fontFamily:"'Bebas Neue', sans-serif", letterSpacing:"2px", margin:"1rem 0 0.5rem", color:"var(--gray-light)"}}>PAST</h3>
              {past.map(b => (
                <div key={b.id} className="booking-item past">
                  <div className="booking-info">
                    <h4>{b.slotDate.toDate().toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" })}</h4>
                    <p>⏰ {b.slotTime || b.slotDate.toDate().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</p>
                  </div>
                  <span className="booking-status status-past">Done</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
