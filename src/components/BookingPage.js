import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection, query, where, getDocs, addDoc, Timestamp
} from "firebase/firestore";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function BookingPage({ user }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);           // available slots for selected date
  const [bookedSlots, setBookedSlots] = useState([]); // already booked slot ids
  const [datesWithSlots, setDatesWithSlots] = useState(new Set());
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load which dates have slots this month (for dots on calendar)
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
      snap.forEach(doc => {
        const d = doc.data().datetime.toDate();
        dates.add(d.toDateString());
      });
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
      const q = query(
        collection(db, "slots"),
        where("datetime", ">=", Timestamp.fromDate(start)),
        where("datetime", "<=", Timestamp.fromDate(end))
      );
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => a.datetime.toDate() - b.datetime.toDate());
      setSlots(list);

      // Get bookings for this date to know which slots are taken
      const bq = query(
        collection(db, "bookings"),
        where("slotDate", ">=", Timestamp.fromDate(start)),
        where("slotDate", "<=", Timestamp.fromDate(end))
      );
      const bsnap = await getDocs(bq);
      const booked = new Set();
      bsnap.forEach(doc => booked.add(doc.data().slotId));
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
      await addDoc(collection(db, "bookings"), {
        slotId: selectedSlot,
        slotDate: slot.datetime,
        slotTime: slot.label,
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName,
        bookedAt: Timestamp.now(),
      });
      setBookedSlots(prev => new Set([...prev, selectedSlot]));
      setSelectedSlot(null);
      showToast("✅ Booking confirmed!");
    } catch (e) {
      showToast("Something went wrong. Try again.", "error");
    }
    setLoading(false);
  };

  // Calendar helpers
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const formatTime = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const selectedSlotObj = slots.find(s => s.id === selectedSlot);

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
            <button className="cal-nav" onClick={prevMonth}>‹</button>
            <span>{MONTHS[month]} {year}</span>
            <button className="cal-nav" onClick={nextMonth}>›</button>
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
                <div
                  key={i}
                  className={`cal-day ${isPast ? "disabled" : "has-slots"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
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
                  <button
                    key={slot.id}
                    className={`slot-btn ${isBooked ? "booked" : ""} ${isSelected ? "selected" : ""}`}
                    disabled={isBooked}
                    onClick={() => setSelectedSlot(isSelected ? null : slot.id)}
                  >
                    {slot.label || formatTime(slot.datetime.toDate())}
                    {isBooked && <div style={{fontSize:"0.65rem", marginTop:"2px"}}>Taken</div>}
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
              <strong>{selectedDate?.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })}</strong>
            </div>
            <div className="confirm-detail">
              <span>⏰ Time</span>
              <strong>{selectedSlotObj.label || formatTime(selectedSlotObj.datetime.toDate())}</strong>
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
