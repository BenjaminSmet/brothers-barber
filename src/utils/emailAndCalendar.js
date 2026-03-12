import emailjs from "@emailjs/browser";

const SERVICE_ID = process.env.REACT_APP_EMAILJS_SERVICE_ID;
const PUBLIC_KEY = process.env.REACT_APP_EMAILJS_PUBLIC_KEY;
const TEMPLATE_CONFIRM = process.env.REACT_APP_EMAILJS_TEMPLATE_CONFIRM;
const TEMPLATE_ADMIN = process.env.REACT_APP_EMAILJS_TEMPLATE_ADMIN;
const ADMIN_EMAIL = process.env.REACT_APP_ADMIN_EMAIL;

function toIcalDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  );
}

// Generate .ics content for a 30-min appointment
export function generateIcs({ title, start, description }) {
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const now = toIcalDate(new Date());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barber Benjamin//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `DTSTART:${toIcalDate(start)}`,
    `DTEND:${toIcalDate(end)}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// Create a downloadable data URI from .ics content
export function makeIcsDataUri(icsContent) {
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(icsContent);
}

// Send booking confirmation to brother + notification to admin
export async function sendBookingEmails({ userName, userEmail, slotDate, slotTime }) {
  const dateStr = slotDate.toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  await emailjs.send(SERVICE_ID, TEMPLATE_CONFIRM, {
    to_name: userName,
    to_email: userEmail,
    slot_date: dateStr,
    slot_time: slotTime,
    email_subject: `✂️ Booking confirmed — ${dateStr} at ${slotTime}`,
    is_cancellation: false,
    cancelled_by: "",
  }, PUBLIC_KEY);

  await emailjs.send(SERVICE_ID, TEMPLATE_ADMIN, {
    to_email: ADMIN_EMAIL,
    booker_name: userName,
    booker_email: userEmail,
    slot_date: dateStr,
    slot_time: slotTime,
    email_subject: `New booking — ${userName} on ${dateStr} at ${slotTime}`,
    message: `${userName} (${userEmail}) just booked a slot.`,
  }, PUBLIC_KEY);
}

// Send cancellation emails to brother and admin
export async function sendCancellationEmails({ userName, userEmail, slotDate, slotTime, cancelledByAdmin }) {
  const dateStr = slotDate.toLocaleDateString("en-GB", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const cancelledBy = cancelledByAdmin ? "Benjamin (admin)" : userName;

  await emailjs.send(SERVICE_ID, TEMPLATE_CONFIRM, {
    to_name: userName,
    to_email: userEmail,
    slot_date: dateStr,
    slot_time: slotTime,
    email_subject: `❌ Booking cancelled — ${dateStr} at ${slotTime}`,
    is_cancellation: true,
    cancelled_by: cancelledBy,
  }, PUBLIC_KEY);

  await emailjs.send(SERVICE_ID, TEMPLATE_ADMIN, {
    to_email: ADMIN_EMAIL,
    booker_name: userName,
    booker_email: userEmail,
    slot_date: dateStr,
    slot_time: slotTime,
    email_subject: `❌ Cancellation — ${userName} on ${dateStr} at ${slotTime}`,
    message: `${cancelledBy} cancelled the booking for ${userName}.`,
  }, PUBLIC_KEY);
}
