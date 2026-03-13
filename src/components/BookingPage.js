import { useState, useEffect, useRef } from "react";
import { db, storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, query, where, getDocs, addDoc, Timestamp } from "firebase/firestore";
import { notifyAdminOfRequest, generateIcs, makeIcsDataUri } from "../utils/emailAndCalendar";

const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function getPickableTimes(windowStart, windowEnd, existingBookings) {
  const times = [];
  let cur = new Date(windowStart);
  const lastStart = new Date(windowEnd.getTime() - 60 * 60000);
  while (cur <= lastStart) {
    const slotEnd = new Date(cur.getTime() + 60 * 60000);
    const isTaken = existingBookings.some(b => {
      const bs = b.startTime.toDate();
      const be = new Date(bs.getTime() + 60 * 60000);
      return cur < be && slotEnd > bs;
    });
    if (!isTaken) times.push(new Date(cur));
    cur = new Date(cur.getTime() + 30 * 60000);
  }
  return times;
}

export default function BookingPage({ user }) {
  const [currentMonth, setCurrentMonth]   = useState(new Date());
  const [selectedDate, setSelectedDate]   = useState(null);
  const [windows, setWindows]             = useState([]);
  const [bookings, setBookings]           = useState([]);
  const [datesWithWindows, setDatesWithWindows] = useState(new Set());
  const [selectedWindow, setSelectedWindow] = useState(null);
  const [selectedTime, setSelectedTime]   = useState(null);
  const [photo, setPhoto]                 = useState(null);
  const [photoPreview, setPhotoPreview]   = useState(null);
  const [loading, setLoading]             = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [toast, setToast]                 = useState(null);
  const fileInputRef                      = useRef();

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

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

  useEffect(() => {
    if (!selectedDate) return;
    const load = async () => {
      const start = new Date(selectedDate); start.setHours(0,0,0,0);
      const end   = new Date(selectedDate); end.setHours(23,59,59,999);
      const [wSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, "windows"), where("start", ">=", Timestamp.fromDate(start)), where("start", "<=", Timestamp.fromDate(end)))),
        getDocs(query(collection(db, "bookings"), where("startTime", ">=", Timestamp.fromDate(start)), where("startTime", "<=", Timestamp.fromDate(end)))),
      ]);
      const wList = []; wSnap.forEach(d => wList.push({ id: d.id, ...d.data() }));
      wList.sort((a,b) => a.start.toDate() - b.start.toDate());
      setWindows(wList);
      const bList = []; bSnap.forEach(d => bList.push({ id: d.id, ...d.data() }));
      // Only block confirmed bookings, not pending
      setBookings(bList.filter(b => b.status === "confirmed"));
    };
    load();
    setSelectedWindow(null); setSelectedTime(null);
  }, [selectedDate]);

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast("Photo must be under 5MB", "error");
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleBook = async () => {
    if (!selectedWindow || !selectedTime) return;
    setLoading(true);
    try {
      const startTime = selectedTime;
      const timeLabel = startTime.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

      // Upload photo if provided
      let photoUrl = null;
      if (photo) {
        const photoRef = ref(storage, `haircut-photos/${user.uid}/${Date.now()}-${photo.name}`);
        await uploadBytes(photoRef, photo);
        photoUrl = await getDownloadURL(photoRef);
      }

      // Save booking as pending
      await addDoc(collection(db, "bookings"), {
        windowId:  selectedWindow.id,
        startTime: Timestamp.fromDate(startTime),
        endTime:   Timestamp.fromDate(new Date(startTime.getTime() + 60*60000)),
        slotTime:  timeLabel,
        slotDate:  Timestamp.fromDate(startTime),
        status:    "pending",
        photoUrl:  photoUrl || null,
        userId:    user.uid,
        userEmail: user.email,
        userName:  user.displayName,
        bookedAt:  Timestamp.now(),
      });

      // Notify admin
      try {
        await notifyAdminOfRequest({
          userName:  user.displayName,
          userEmail: user.email,
          slotDate:  startTime,
          slotTime:  timeLabel,
          photoUrl,
        });
      } catch (e) { console.warn("Email failed:", e); }

      setConfirmedBooking({ slotDate: startTime, slotTime: timeLabel });
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
  const year = currentMonth.getFullYear(), month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(new Date(year, month, d));

  // ── Pending screen ───────────────────────────────────────────
  if (confirmedBooking) {
    const dateStr = confirmedBooking.slotDate.toLocaleDateString("en-GB", {
      weekday:"long", month:"long", day:"numeric", year:"numeric"
    });
    return (
      <div className="confirmed-screen">
        <div className="confirmed-card">
          <div className="confirmed-icon">⏳</div>
          <h2>Request sent!</h2>
          <p className="confirmed-sub">Waiting for Benjamin to confirm</p>
          <div className="confirmed-details">
            <div className="confirmed-detail-row"><span>📅</span><strong>{dateStr}</strong></div>
            <div className="confirmed-detail-row"><span>⏰</span><strong>{confirmedBooking.slotTime} (1 hour)</strong></div>
            <div className="confirmed-detail-row"><span>✂️</span><strong>Barber Benjamin</strong></div>
          </div>
          <p className="confirmed-email-note">You'll get an email once it's approved or denied.</p>
          <button className="cal-add-btn" style={{background:"var(--gray-mid)"}} onClick={handleAddToCalendar}>
            📅 Save date (pending)
          </button>
          <button className="book-another-btn" onClick={() => setConfirmedBooking(null)}>← Back</button>
        </div>
      </div>
    );
  }

  // ── Booking screen ───────────────────────────────────────────
  return (
    <div>
      <div className="section-header">
        <h2>✂ Book a Cut</h2>
        <p>Pick a date and time — Benjamin will confirm your request</p>
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
              const isPast = day < today;
              const isToday = day.toDateString() === today.toDateString();
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
                          const isSelected = selectedTime?.getTime() === dt.getTime() && selectedWindow?.id === w.id;
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

      {/* Photo upload + confirm */}
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

          {/* Photo upload */}
          <div className="photo-upload-section">
            <p className="photo-upload-label">📸 Add a reference photo <span style={{color:"var(--gray-light)"}}>(optional)</span></p>
            <div className="photo-upload-area" onClick={() => fileInputRef.current.click()}>
              {photoPreview ? (
                <img src={photoPreview} alt="preview" className="photo-preview" />
              ) : (
                <div className="photo-placeholder">
                  <span style={{fontSize:"2rem"}}>📷</span>
                  <span>Tap to upload a photo of your desired haircut</span>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoChange} />
            {photoPreview && (
              <button className="remove-photo-btn" onClick={() => { setPhoto(null); setPhotoPreview(null); }}>
                ✕ Remove photo
              </button>
            )}
          </div>

          <button className="confirm-btn" onClick={handleBook} disabled={loading}>
            {loading ? "Sending request..." : "SEND BOOKING REQUEST →"}
          </button>
        </div>
      )}

      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
