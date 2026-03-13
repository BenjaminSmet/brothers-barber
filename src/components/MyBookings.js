import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { notifyCancellation, generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

export default function MyBookings({ user }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(query(collection(db, "bookings"), where("userId", "==", user.uid)));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a,b) => a.startTime.toDate() - b.startTime.toDate());
      setBookings(list);
      setLoading(false);
    };
    load();
  }, [user.uid]);

  const handleCancel = async (booking) => {
    if (!window.confirm("Cancel this booking?")) return;
    await updateDoc(doc(db, "bookings", booking.id), { status: "cancelled" });
    setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: "cancelled" } : b));
    try {
      await notifyCancellation({
        userName: booking.userName, userEmail: booking.userEmail,
        slotDate: booking.startTime.toDate(), slotTime: booking.slotTime,
        cancelledByAdmin: false,
      });
    } catch (e) { console.warn("Email failed:", e); }
    showToast("Booking cancelled.");
  };

  const handleAddToCalendar = (booking) => {
    const ics = generateIcs({
      title: "✂️ Haircut — Barber Benjamin",
      start: booking.startTime.toDate(),
      description: `Haircut at ${booking.slotTime} with Barber Benjamin`,
    });
    const a = document.createElement("a");
    a.href = makeIcsDataUri(ics);
    a.download = "haircut-barber-benjamin.ics";
    a.click();
  };

  const now      = new Date();
  const upcoming = bookings.filter(b => b.startTime.toDate() >= now && b.status !== "cancelled" && b.status !== "denied");
  const past     = bookings.filter(b => b.startTime.toDate() <  now || b.status === "cancelled" || b.status === "denied");

  const statusBadge = (b) => {
    if (b.status === "pending")   return <span className="booking-status status-pending">Pending</span>;
    if (b.status === "confirmed") return <span className="booking-status status-upcoming">Confirmed</span>;
    if (b.status === "denied")    return <span className="booking-status status-past">Denied</span>;
    if (b.status === "cancelled") return <span className="booking-status status-past">Cancelled</span>;
    return null;
  };

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
              {upcoming.map(b => {
                const start = b.startTime.toDate();
                const end   = new Date(start.getTime() + 60*60000);
                return (
                  <div key={b.id} className="booking-item">
                    <div className="booking-info">
                      <h4>{start.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" })}</h4>
                      <p>⏰ {start.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} – {end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</p>
                    </div>
                    <div style={{display:"flex", alignItems:"center", gap:"0.5rem", flexWrap:"wrap"}}>
                      {statusBadge(b)}
                      {b.status === "confirmed" && (
                        <button className="cal-mini-btn" onClick={() => handleAddToCalendar(b)}>📅</button>
                      )}
                      {(b.status === "pending" || b.status === "confirmed") && (
                        <button className="cancel-btn" onClick={() => handleCancel(b)}>Cancel</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {past.length > 0 && (
            <>
              <h3 style={{fontFamily:"'Bebas Neue', sans-serif", letterSpacing:"2px", margin:"1rem 0 0.5rem", color:"var(--gray-light)"}}>PAST</h3>
              {past.map(b => {
                const start = b.startTime.toDate();
                const end   = new Date(start.getTime() + 60*60000);
                return (
                  <div key={b.id} className="booking-item past">
                    <div className="booking-info">
                      <h4>{start.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" })}</h4>
                      <p>⏰ {start.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} – {end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</p>
                    </div>
                    {statusBadge(b)}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
