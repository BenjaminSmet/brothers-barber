import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection, query, where, getDocs, addDoc, Timestamp
} from "firebase/firestore";
import { sendBookingEmails, generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

// Generate every 30-min start time within a window (leaving 1hr before end)
function getPickableTimes(windowStart, windowEnd, existingBookings) {
  const times = [];
  let cur = new Date(windowStart);
  // Last valid start = end - 1 hour
  const lastStart = new Date(windowEnd.getTime() - 60 * 60000);

  while (cur <= lastStart) {
    const slotEnd = new Date(cur.getTime() + 60 * 60000);
    // Check overlap with existing bookings
    const isTaken = existingBookings.some(b => {
      const bs = b.startTime.toDate();
      const be = new Date(bs.getTime() + 60 * 60000);
      return cur < be && slotEnd > bs;
    });
    if (!isTaken) times.push(new Date(cur));
    cur = new Date(cur.getTime() + 30 * 60000); // offer every 30min as start
  }
  return times;
}

export default function BookingPage({ user }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate]   = useState(null);
  const [windows, setWindows]             = useState([]); // availability windows for selected date
  const [bookings, setBookings]           = useState([]); // existing bookings for selected date
  const [datesWithWindows, setDatesWithWindows] = useState(new Set());
  const [selectedWindow, setSelectedWindow]   = useState(null);
  const [selectedTime, setSelectedTime]       = useState(null);
  const [loading, setLoading]             = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [toast, setToast]                 = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load which dates have windows this month
  useEffect(() => {
    const load = async () => {
      const y = currentMonth.getFullYear();
      const m = currentMonth.getMonth();
      const start = new Date(y, m, 1);
      const end   = new Date(y, m+1, 0, 23, 59, 59);
      const snap  = await getDocs(query(
        collection(db, "windows"),
        where("start", ">=", Timestamp.fromDate(start)),
        where("start", "<=", Timestamp.fromDate(end))
      ));
      const dates = new Set();
      snap.forEach(d => dates.add(d.data().start.toDate().toDateString()));
      setDatesWithWindows(dates);
    };
    load();
  }, [currentMonth]);

  // Load windows + bookings for selected date
  useEffect(() => {
    if (!selectedDate) return;
    const load = async () => {
      const start = new Date(selectedDate); start.setHours(0,0,0,0);
      const end   = new Date(selectedDate); end.setHours(23,59,59,999);

      const [wSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, "windows"),
          where("start", ">=", Timestamp.fromDate(start)),
          where("start", "<=", Timestamp.fromDate(end))
        )),
        getDocs(query(collection(db, "bookings"),
          where("startTime", ">=", Timestamp.fromDate(start)),
          where("startTime", "<=", Timestamp.fromDate(end))
        )),
      ]);

      const wList = [];
      wSnap.forEach(d => wList.push({ id: d.id, ...d.data() }));
      wList.sort((a,b) => a.start.toDate() - b.start.toDate());
      setWindows(wList);

      const bList = [];
      bSnap.forEach(d => bList.push({ id: d.id, ...d.data() }));
      setBookings(bList);
    };
    load();
    setSelectedWindow(null);
    setSelectedTime(null);
  }, [selectedDate]);

  const handleBook = async () => {
    if (!selectedWindow || !selectedTime) return;
    setLoading(true);
    try {
      const startTime = selectedTime;
      const endTime   = new Date(startTime.getTime() + 60 * 60000);
      const timeLabel = startTime.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

      await addDoc(collection(db, "bookings"), {
        windowId:  selectedWindow.id,
        startTime: Timestamp.fromDate(startTime),
        endTime:   Timestamp.fromDate(endTime),
        slotTime:  timeLabel,
        slotDate:  Timestamp.fromDate(startTime), // keep for MyBookings compatibility
        userId:    user.uid,
        userEmail: user.email,
        userName:  user.displayName,
        bookedAt:  Timestamp.now(),
      });

      try {
        await sendBookingEmails({
          userName:  user.displayName,
          userEmail: user.email,
          slotDate:  startTime,
          slotTime:  timeLabel,
        });
      } catch (e) { console.warn("Email failed:", e); }

      setConfirmedBooking({ slotDate: startTime, slotTime: timeLabel, userName: user.displayName });
    } catch (e) {
      console.error(e);
      showToast("Something went wrong. Try again.", "error");
    }
    setLoading(false);
  };

  const handleAddToCalendar = () => {
    if (!confirmedBooking) return;
    const ics = generateIcs({
      title: "✂️ Haircut — Barber Benjamin",
      start: confirmedBooking.slotDate,
      description: `Haircut at ${confirmedBooking.slotTime} with Barber Benjamin`,
    });
    const a = document.createElement("a");
    a.href = makeIcsDataUri(ics);
    a.download = "haircut-barber-benjamin.ics";
    a.click();
  };

  // Calendar
  const year        = currentMonth.getFullYear();
  const month       = currentMonth.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today       = new Date(); today.setHours(0,0,0,0);
  const calDays     = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  const availableTimes = (selectedWindow)
    ? getPickableTimes(
        selectedWindow.start.toDate(),
        selectedWindow.end.toDate(),
        bookings
      )
    : [];

  // ── Confirmed screen ─────────────────────────────────────────
  if (confirmedBooking) {
    const dateStr = confirmedBooking.slotDate.toLocaleDateString("en-GB", {
      weekday:"long", month:"long", day:"numeric", year:"numeric"
    });
    return (
      <div className="confirmed-screen">
        <div className="confirmed-card">
          <div className="confirmed-icon">✅</div>
          <h2>You're booked!</h2>
          <p className="confirmed-sub">See you on</p>
          <div className="confirmed-details">
            <div className="confirmed-detail-row"><span>📅</span><strong>{dateStr}</strong></div>
            <div className="confirmed-detail-row"><span>⏰</span><strong>{confirmedBooking.slotTime} (1 hour)</strong></div>
            <div className="confirmed-detail-row"><span>✂️</span><strong>Barber Benjamin</strong></div>
          </div>
          <p className="confirmed-email-note">A confirmation email has been sent to you.</p>
          <button className="cal-add-btn" onClick={handleAddToCalendar}>📅 Add to iPhone Calendar</button>
          <button className="book-another-btn" onClick={() => setConfirmedBooking(null)}>← Book another slot</button>
        </div>
      </div>
    );
  }

  // ── Booking screen ───────────────────────────────────────────
  return (
    <div>
      <div className="section-header">
        <h2>✂ Book a Cut</h2>
        <p>Pick a date, then choose your time</p>
      </div>

      <div className="booking-grid">
        {/* Calendar */}
        <div className="card">
          <div className="calendar-header">
            <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month-1, 1))}>‹</button>
            <span>{MONTHS[month]} {year}</span>
            <button className="cal-nav" onClick={() => setCurrentMonth(new Date(year, month+1, 1))}>›</button>
          </div>
          <div className="cal-grid">
            {DAYS.map(d => <div key={d} className="cal-day-label">{d}</div>)}
            {calDays.map((day, i) => {
              if (!day) return <div key={i} className="cal-day empty" />;
              const isPast     = day < today;
              const isToday    = day.toDateString() === today.toDateString();
              const isSelected = selectedDate?.toDateString() === day.toDateString();
              const hasWindows = datesWithWindows.has(day.toDateString());
              return (
                <div key={i}
                  className={["cal-day", isPast?"disabled":"", isToday?"today":"", isSelected?"selected":""].filter(Boolean).join(" ")}
                  onClick={() => !isPast && setSelectedDate(day)}
                >
                  {day.getDate()}
                  {hasWindows && !isPast && <div className="cal-dot" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Time picker */}
        <div className="card">
          <h3>⏱ PICK A TIME</h3>
          {!selectedDate ? (
            <div className="no-slots">← Pick a date first</div>
          ) : windows.length === 0 ? (
            <div className="no-slots">No availability this day</div>
          ) : (
            <div style={{display:"flex", flexDirection:"column", gap:"1rem"}}>
              {windows.map(w => {
                const times = getPickableTimes(w.start.toDate(), w.end.toDate(), bookings);
                const isWindowSelected = selectedWindow?.id === w.id;
                return (
                  <div key={w.id}>
                    <div className="window-label">
                      {w.start.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      {" – "}
                      {w.end.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                    </div>
                    {times.length === 0 ? (
                      <div className="no-slots" style={{padding:"0.5rem 0", fontSize:"0.82rem"}}>Fully booked</div>
                    ) : (
                      <div className="slots-grid">
                        {times.map((dt, i) => {
                          const isSelected = selectedTime?.getTime() === dt.getTime() && isWindowSelected;
                          return (
                            <button key={i}
                              className={`slot-btn ${isSelected ? "selected" : ""}`}
                              onClick={() => { setSelectedWindow(w); setSelectedTime(dt); }}
                            >
                              {dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirm panel */}
      {selectedTime && selectedWindow && (
        <div className="confirm-panel">
          <div className="confirm-summary">
            <div className="confirm-detail">
              <span>📅 Date</span>
              <strong>{selectedDate?.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric" })}</strong>
            </div>
            <div className="confirm-detail">
              <span>⏰ Time</span>
              <strong>
                {selectedTime.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                {" – "}
                {new Date(selectedTime.getTime()+60*60000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
              </strong>
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
