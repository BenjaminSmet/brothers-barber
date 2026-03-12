import { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, query, where, getDocs, addDoc, Timestamp } from "firebase/firestore";
import { sendBookingEmails, generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function BookingPage({ user }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [bookedSlots, setBookedSlots] = useState(new Set());
  const [datesWithSlots, setDatesWithSlots] = useState(new Set());
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null); // after booking success
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load dates with slots for the current month
  useEffect(() => {
    const fetchDates = async () => {
      const y = currentMonth.getFullYear();
      const m = currentMonth.getMonth();
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      const q = query(
        collection(db, "slots"),
        where("datetime", ">=", Timestamp.fromDate(start)),
        where("datetime", "<=", Timestamp.fromDate(end))
      );
      const snap = await getDocs(q);
      const dates = new Set();
      snap.forEach(doc => dates.add(doc.data().datetime.toDate().toDateString()));
      setDatesWithSlots(dates);
    };
    fetchDates();
  }, [currentMonth]);

  // Load slots for selected date
  useEffect(() => {
    if (!selectedDate) return;
    const fetchSlots = async () => {
      const start = new Date(selectedDate); start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate); end.setHours(23, 59, 59, 999);
      const [sSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, "slots"), where("datetime", ">=", Timestamp.fromDate(start)), where("datetime", "<=", Timestamp.fromDate(end)))),
        getDocs(query(collection(db, "bookings"), where("slotDate", ">=", Timestamp.fromDate(start)), where("slotDate", "<=", Timestamp.fromDate(end)))),
      ]);
      const list = [];
      sSnap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => a.datetime.toDate() - b.datetime.toDate());
      setSlots(list);
      const booked = new Set();
      bSnap.forEach(doc => booked.add(doc.data().slotId));
      setBookedSlots(booked);
    };
    fetchSlots();
    setSelectedSlot(null);
  }, [selectedDate]);

  const handleBook = async () => {
    if (!selectedSlot) return;
    setLoading(true);
    try {
      const slot = slots.find(s => s.id === selectedSlot);
      const slotDate = slot.datetime.toDate();
      const slotTime = slot.label || slotDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      await addDoc(collection(db, "bookings"), {
        slotId: selectedSlot,
        slotDate: slot.datetime,
        slotTime,
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName,
        bookedAt: Timestamp.now(),
      });

      // Send emails (don't block the UI if this fails)
      try {
        await sendBookingEmails({
          userName: user.displayName,
          userEmail: user.email,
          slotDate,
          slotTime,
        });
      } catch (emailErr) {
        console.warn("Email failed:", emailErr);
      }

      setBookedSlots(prev => new Set([...prev, selectedSlot]));
      setSelectedSlot(null);
      setConfirmedBooking({ slotDate, slotTime, userName: user.displayName });
    } catch (e) {
      console.error(e);
      showToast("Something went wrong. Try again.", "error");
    }
    setLoading(false);
  };

  // Generate .ics and trigger download
  const handleAddToCalendar = () => {
    if (!confirmedBooking) return;
    const ics = generateIcs({
      title: "✂️ Haircut — Barber Benjamin",
      start: confirmedBooking.slotDate,
      description: `Haircut appointment with Barber Benjamin at ${confirmedBooking.slotTime}`,
    });
    const uri = makeIcsDataUri(ics);
    const a = document.createElement("a");
    a.href = uri;
    a.download = "haircut-barber-benjamin.ics";
    a.click();
  };

  // Calendar helpers
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  const selectedSlotObj = slots.find(s => s.id === selectedSlot);

  // ── Confirmed screen ──────────────────────────────────────────
  if (confirmedBooking) {
    const dateStr = confirmedBooking.slotDate.toLocaleDateString("en-GB", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    return (
      <div className="confirmed-screen">
        <div className="confirmed-card">
          <div className="confirmed-icon">✅</div>
          <h2>You're booked!</h2>
          <p className="confirmed-sub">See you on</p>
          <div className="confirmed-details">
            <div className="confirmed-detail-row">
              <span>📅</span>
              <strong>{dateStr}</strong>
            </div>
            <div className="confirmed-detail-row">
              <span>⏰</span>
              <strong>{confirmedBooking.slotTime}</strong>
            </div>
            <div className="confirmed-detail-row">
              <span>✂️</span>
              <strong>Barber Benjamin</strong>
            </div>
          </div>
          <p className="confirmed-email-note">A confirmation email has been sent to you.</p>
          <button className="cal-add-btn" onClick={handleAddToCalendar}>
            📅 Add to iPhone Calendar
          </button>
          <button className="book-another-btn" onClick={() => setConfirmedBooking(null)}>
            ← Book another slot
          </button>
        </div>
      </div>
    );
  }

  // ── Booking screen ────────────────────────────────────────────
  return (
    <div>
      <div className="section-header">
        <h2>✂ Book a Cut</h2>
        <p>Pick a date then choose your time slot</p>
      </div>

      <div className="booking-grid">
        {/* Calendar */}
        <div className="card">
          <div className="calendar-header">
            <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}>‹</button>
            <span>{MONTHS[month]} {year}</span>
            <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}>›</button>
          </div>
          <div className="cal-grid">
            {DAYS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
            {calDays.map((day, i) => {
              if (!day) return <div key={i} className="cal-day empty" />;
              const isPast = day < today;
              const isToday = day.toDateString() === today.toDateString();
              const isSelected = selectedDate?.toDateString() === day.toDateString();
              const hasSlots = datesWithSlots.has(day.toDateString());
              return (
                <div key={i}
                  className={`cal-day ${isPast ? "disabled" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                  onClick={() => !isPast && setSelectedDate(day)}
                >
                  {day.getDate()}
                  {hasSlots && !isPast && <div className="cal-dot" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Time slots */}
        <div className="card">
          <h3>⏱ TIME SLOTS</h3>
          {!selectedDate ? (
            <div className="no-slots">← Pick a date first</div>
          ) : slots.length === 0 ? (
            <div className="no-slots">No slots available this day</div>
          ) : (
            <div className="slots-grid">
              {slots.map(slot => {
                const isBooked = bookedSlots.has(slot.id);
                const isSelected = selectedSlot === slot.id;
                return (
                  <button key={slot.id}
                    className={`slot-btn ${isBooked ? "booked" : ""} ${isSelected ? "selected" : ""}`}
                    disabled={isBooked}
                    onClick={() => setSelectedSlot(isSelected ? null : slot.id)}
                  >
                    {slot.label || slot.datetime.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {isBooked && <div style={{ fontSize: "0.65rem", marginTop: "2px" }}>Taken</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirm panel */}
      {selectedSlotObj && (
        <div className="confirm-panel">
          <div className="confirm-summary">
            <div className="confirm-detail">
              <span>📅 Date</span>
              <strong>{selectedDate?.toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" })}</strong>
            </div>
            <div className="confirm-detail">
              <span>⏰ Time</span>
              <strong>{selectedSlotObj.label}</strong>
            </div>
            <div className="confirm-detail">
              <span>👤 Name</span>
              <strong>{user.displayName}</strong>
            </div>
          </div>
          <button className="confirm-btn" onClick={handleBook} disabled={loading}>
            {loading ? "Booking..." : "CONFIRM BOOKING →"}
          </button>
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
