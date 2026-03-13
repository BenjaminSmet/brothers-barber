const WORKER_URL = "https://ical-proxy.benjamin-smet29.workers.dev";
const ADMIN_EMAIL = process.env.REACT_APP_ADMIN_EMAIL;

// ── Email sender ──────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Email failed: ${text}`);
  }
}

// ── Email templates ───────────────────────────────────────────
function bookingRequestHtml({ userName, slotDate, slotTime, photoUrl }) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0d0d0d;color:#f5f0e8;border-radius:16px;overflow:hidden;">
      <div style="background:#c0392b;padding:24px 32px;">
        <h1 style="margin:0;font-size:24px;letter-spacing:2px;">✂ BARBER BENJAMIN</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;">New Booking Request</h2>
        <p style="color:#888;margin:0 0 24px;">Someone wants a haircut!</p>
        <div style="background:#1a1a1a;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;"><strong>👤 Name:</strong> ${userName}</p>
          <p style="margin:0 0 8px;"><strong>📅 Date:</strong> ${slotDate}</p>
          <p style="margin:0;"><strong>⏰ Time:</strong> ${slotTime}</p>
        </div>
        ${photoUrl ? `
        <div style="margin-bottom:24px;">
          <p style="color:#888;font-size:13px;margin-bottom:8px;">REQUESTED STYLE</p>
          <img src="${photoUrl}" style="width:100%;border-radius:12px;max-height:300px;object-fit:cover;" />
        </div>` : ""}
        <p style="color:#888;font-size:13px;">Log in to the admin panel to approve or deny this request.</p>
      </div>
    </div>`;
}

function bookingConfirmedHtml({ userName, slotDate, slotTime }) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0d0d0d;color:#f5f0e8;border-radius:16px;overflow:hidden;">
      <div style="background:#c0392b;padding:24px 32px;">
        <h1 style="margin:0;font-size:24px;letter-spacing:2px;">✂ BARBER BENJAMIN</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;">Booking Confirmed ✅</h2>
        <p style="color:#888;margin:0 0 24px;">Your appointment is locked in!</p>
        <div style="background:#1a1a1a;border-radius:12px;padding:20px;">
          <p style="margin:0 0 8px;"><strong>👤 Name:</strong> ${userName}</p>
          <p style="margin:0 0 8px;"><strong>📅 Date:</strong> ${slotDate}</p>
          <p style="margin:0;"><strong>⏰ Time:</strong> ${slotTime}</p>
        </div>
      </div>
    </div>`;
}

function bookingDeniedHtml({ userName, slotDate, slotTime }) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0d0d0d;color:#f5f0e8;border-radius:16px;overflow:hidden;">
      <div style="background:#2a2a2a;padding:24px 32px;">
        <h1 style="margin:0;font-size:24px;letter-spacing:2px;">✂ BARBER BENJAMIN</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;">Booking Not Available ❌</h2>
        <p style="color:#888;margin:0 0 24px;">Unfortunately this slot didn't work out.</p>
        <div style="background:#1a1a1a;border-radius:12px;padding:20px;">
          <p style="margin:0 0 8px;"><strong>📅 Date:</strong> ${slotDate}</p>
          <p style="margin:0;"><strong>⏰ Time:</strong> ${slotTime}</p>
        </div>
        <p style="color:#888;font-size:13px;margin-top:24px;">Please go back to the site and pick another time.</p>
      </div>
    </div>`;
}

function cancellationHtml({ userName, slotDate, slotTime, cancelledBy }) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0d0d0d;color:#f5f0e8;border-radius:16px;overflow:hidden;">
      <div style="background:#2a2a2a;padding:24px 32px;">
        <h1 style="margin:0;font-size:24px;letter-spacing:2px;">✂ BARBER BENJAMIN</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;">Booking Cancelled</h2>
        <p style="color:#888;margin:0 0 24px;">Cancelled by ${cancelledBy}.</p>
        <div style="background:#1a1a1a;border-radius:12px;padding:20px;">
          <p style="margin:0 0 8px;"><strong>👤 Name:</strong> ${userName}</p>
          <p style="margin:0 0 8px;"><strong>📅 Date:</strong> ${slotDate}</p>
          <p style="margin:0;"><strong>⏰ Time:</strong> ${slotTime}</p>
        </div>
      </div>
    </div>`;
}

// ── Public email functions ────────────────────────────────────
export async function notifyAdminOfRequest({ userName, userEmail, slotDate, slotTime, photoUrl }) {
  const dateStr = slotDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" });
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `✂️ New booking request — ${userName} on ${dateStr} at ${slotTime}`,
    html: bookingRequestHtml({ userName, slotDate: dateStr, slotTime, photoUrl }),
  });
}

export async function notifyBrotherConfirmed({ userName, userEmail, slotDate, slotTime }) {
  const dateStr = slotDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" });
  await sendEmail({
    to: userEmail,
    subject: `✅ Booking confirmed — ${dateStr} at ${slotTime}`,
    html: bookingConfirmedHtml({ userName, slotDate: dateStr, slotTime }),
  });
}

export async function notifyBrotherDenied({ userName, userEmail, slotDate, slotTime }) {
  const dateStr = slotDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" });
  await sendEmail({
    to: userEmail,
    subject: `❌ Booking not available — ${dateStr} at ${slotTime}`,
    html: bookingDeniedHtml({ userName, slotDate: dateStr, slotTime }),
  });
}

export async function notifyCancellation({ userName, userEmail, slotDate, slotTime, cancelledByAdmin }) {
  const dateStr = slotDate.toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric" });
  const cancelledBy = cancelledByAdmin ? "Benjamin" : userName;
  const html = cancellationHtml({ userName, slotDate: dateStr, slotTime, cancelledBy });
  await sendEmail({ to: userEmail, subject: `Booking cancelled — ${dateStr} at ${slotTime}`, html });
  await sendEmail({ to: ADMIN_EMAIL, subject: `Booking cancelled — ${userName} on ${dateStr} at ${slotTime}`, html });
}

// ── iCal helpers ──────────────────────────────────────────────
function toIcalDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

export function generateIcs({ title, start, description }) {
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Barber Benjamin//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `DTSTART:${toIcalDate(start)}`, `DTEND:${toIcalDate(end)}`,
    `DTSTAMP:${toIcalDate(new Date())}`,
    `SUMMARY:${title}`, `DESCRIPTION:${description}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function makeIcsDataUri(icsContent) {
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(icsContent);
}
