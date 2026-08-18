/*
 * HTML and plain-text bodies for the two booking emails.
 *
 * Written for Gmail, which is the constraint that shapes all of it: table-based
 * layout because Gmail strips float and drops most of flexbox and grid; inline
 * styles on every element because Gmail strips <style> blocks entirely in some
 * clients and ignores external stylesheets in all of them; no media queries
 * relied on for correctness, only a max-width table that collapses naturally on
 * a phone; no web fonts. Colors match the site's Tailwind palette.
 *
 * The owner notification's HTML part is decorative only -- the machine-readable
 * payload rides in the plain-text part. See the contract note in Booking.ts.
 */

import { IBookingPayload, NA, serializeBookingBlock } from "./Booking";

/*
 * The site's palette, so an email reads as coming from the same place.
 *
 * Bone ground, ink type, and cyan used once per section rather than everywhere.
 * The accent is the darker cyan, not the bright one: the bright value is for a
 * mark sitting on a photograph, and on a pale ground at small sizes it stops
 * being readable, which is the same reason the site's Est. 2013 line uses it.
 */
const COLORS = {
  brand: "#0b6f85",     // dark cyan, holds contrast on bone
  ink: "#1b2436",       // headline navy
  body: "#4b5563",      // body copy
  muted: "#6f7683",     // labels
  hairline: "#e2ddd5",  // rules
  panel: "#efebe5",     // slot cards
  page: "#f5f2ee"       // bone ground
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface IRenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/* Escapes the five characters that would otherwise break out of HTML context.
   Every value below is client-supplied, so all of it goes through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* "N/A" reads as a placeholder in a table but as noise in a sentence. */
const display = (value: string): string => (value === NA ? "Not provided" : value);

/* The three preferred slots, minus the ones the client left blank. */
function offeredSlots(payload: IBookingPayload): Array<{ label: string, date: string, availability: string }> {
  return [
    { label: "Option 1", date: payload.date1, availability: payload.avail1 },
    { label: "Option 2", date: payload.date2, availability: payload.avail2 },
    { label: "Option 3", date: payload.date3, availability: payload.avail3 }
  ].filter((slot) => slot.date !== NA || slot.availability !== NA);
}

/* Renders YYYY-MM-DD as "Wednesday, August 5, 2026". Falls back to the raw
   value if it is anything else, so nothing is ever lost to formatting. */
function longDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { return display(value); }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) { return value; }
  return parsed.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

/* Outer shell: a centered, max-width table on a tinted page background. */
function wrap(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:0; background-color:${COLORS.page}; font-family:${FONT}; color:${COLORS.body}; -webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page}; padding:24px 12px;">
<tr>
<td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:8px; border:1px solid ${COLORS.hairline};">
${inner}
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/* Brand-colored header bar with the shop name. */
function header(heading: string): string {
  return `<tr>
<td style="background-color:${COLORS.ink}; padding:24px; border-radius:8px 8px 0 0;">
<h1 style="margin:0; font-family:${FONT}; font-size:20px; line-height:28px; font-weight:bold; color:#ffffff;">${escapeHtml(heading)}</h1>
<p style="margin:4px 0 0 0; font-family:${FONT}; font-size:12px; line-height:20px; letter-spacing:2px; text-transform:uppercase; color:#7fd3e4;">Henry Hai Studio</p>
</td>
</tr>`;
}

function footer(): string {
  return `<tr>
<td style="padding:16px 24px 24px 24px; border-top:1px solid ${COLORS.hairline};">
<p style="margin:0; font-family:${FONT}; font-size:12px; line-height:18px; color:${COLORS.muted};">Henry Hai Studio, Milpitas &amp; Irvine, CA</p>
</td>
</tr>`;
}

/* One label/value row of the details table. */
function detailRow(label: string, value: string): string {
  return `<tr>
<td style="padding:8px 0; border-bottom:1px solid ${COLORS.hairline}; font-family:${FONT}; font-size:14px; line-height:20px; color:${COLORS.muted}; width:38%; vertical-align:top;">${escapeHtml(label)}</td>
<td style="padding:8px 0; border-bottom:1px solid ${COLORS.hairline}; font-family:${FONT}; font-size:14px; line-height:20px; color:${COLORS.ink}; vertical-align:top;">${escapeHtml(value)}</td>
</tr>`;
}

/* A card per preferred slot, used by both emails. */
function slotCards(payload: IBookingPayload): string {
  const slots = offeredSlots(payload);
  if (slots.length === 0) { return ""; }

  return slots.map((slot) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0; background-color:${COLORS.panel}; border-radius:6px;">
<tr>
<td style="padding:12px 16px;">
<p style="margin:0; font-family:${FONT}; font-size:12px; line-height:16px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:${COLORS.brand};">${escapeHtml(slot.label)}</p>
<p style="margin:4px 0 0 0; font-family:${FONT}; font-size:15px; line-height:22px; font-weight:bold; color:${COLORS.ink};">${escapeHtml(longDate(slot.date))}</p>
<p style="margin:2px 0 0 0; font-family:${FONT}; font-size:14px; line-height:20px; color:${COLORS.body};">${escapeHtml(display(slot.availability))}</p>
</td>
</tr>
</table>`).join("\n");
}

/* Same slots as plain text. */
function slotLines(payload: IBookingPayload): string {
  const slots = offeredSlots(payload);
  if (slots.length === 0) { return "  (none provided)"; }

  return slots.map((slot) =>
    `  ${slot.label}: ${longDate(slot.date)}\n    Availability: ${display(slot.availability)}`
  ).join("\n");
}

/*
 * Client confirmation. Echoes the name back and lists every slot the client
 * offered, so they have a record of what they asked for.
 */
export function renderClientConfirmation(payload: IBookingPayload): IRenderedEmail {
  const subject = `Appointment request received - Henry Hai Studio`;

  const html = wrap(subject, `${header("Your request is in")}
<tr>
<td style="padding:24px;">
<p style="margin:0 0 16px 0; font-family:${FONT}; font-size:16px; line-height:24px; color:${COLORS.ink};">Hi ${escapeHtml(payload.name)},</p>
<p style="margin:0 0 20px 0; font-family:${FONT}; font-size:15px; line-height:23px; color:${COLORS.body};">Thanks for booking with me. I&#39;ve received your request and I&#39;ll be in touch shortly to confirm one of the times below. Nothing is locked in until I reply.</p>

<p style="margin:0 0 12px 0; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:bold; color:${COLORS.ink};">The times you offered</p>
${slotCards(payload)}

<p style="margin:20px 0 12px 0; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:bold; color:${COLORS.ink};">What you asked for</p>
<p style="margin:0 0 20px 0; font-family:${FONT}; font-size:15px; line-height:23px; color:${COLORS.body};">${escapeHtml(display(payload.description))}</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${detailRow("Name", display(payload.name))}
${detailRow("Phone", display(payload.phone))}
${detailRow("Submitted", `${payload.date} at ${payload.time} (Pacific)`)}
</table>

<p style="margin:20px 0 0 0; font-family:${FONT}; font-size:14px; line-height:21px; color:${COLORS.muted};">If any of this looks wrong, just reply to this email and I&#39;ll sort it out.</p>
</td>
</tr>
${footer()}`);

  const text = `Hi ${payload.name},

Thanks for booking with me. I've received your request and I'll be in touch
shortly to confirm one of the times below. Nothing is locked in until I reply.

THE TIMES YOU OFFERED
${slotLines(payload)}

WHAT YOU ASKED FOR
  ${display(payload.description)}

YOUR DETAILS
  Name: ${display(payload.name)}
  Phone: ${display(payload.phone)}
  Submitted: ${payload.date} at ${payload.time} (Pacific)

If any of this looks wrong, just reply to this email and I'll sort it out.

--
Henry Hai Studio
Milpitas & Irvine, CA
`;

  return { subject, text, html };
}

/*
 * Owner notification.
 *
 * The subject line keeps starting with "Appointment Request from". Every
 * request going back to 2024 is filed under it, so it is what makes the mailbox
 * searchable as a history.
 *
 * The plain-text part ends with the sentinel-wrapped JSON payload, which is the
 * only machine-readable copy of a request outside the sheet. Everything above
 * it, and the whole HTML part, is for reading.
 */
export function renderOwnerNotification(
  payload: IBookingPayload,
  clientEmail?: string
): IRenderedEmail {
  const subject = `Appointment Request from ${payload.name}`;

  const contactRows = [
    detailRow("Phone", display(payload.phone)),
    clientEmail ? detailRow("Email", clientEmail) : "",
    detailRow("Submitted", `${payload.date} at ${payload.time} (Pacific)`)
  ].join("\n");

  const html = wrap(subject, `${header(`New request from ${payload.name}`)}
<tr>
<td style="padding:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
${detailRow("Name", display(payload.name))}
${contactRows}
</table>

<p style="margin:0 0 12px 0; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:bold; color:${COLORS.ink};">Preferred times</p>
${slotCards(payload)}

<p style="margin:20px 0 12px 0; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:bold; color:${COLORS.ink};">Haircut / comments</p>
<p style="margin:0; font-family:${FONT}; font-size:15px; line-height:23px; color:${COLORS.body};">${escapeHtml(display(payload.description))}</p>
</td>
</tr>
${footer()}`);

  const text = `New appointment request from ${payload.name}.

  Name: ${display(payload.name)}
  Phone: ${display(payload.phone)}${clientEmail ? `\n  Email: ${clientEmail}` : ""}
  Submitted: ${payload.date} at ${payload.time} (Pacific)

PREFERRED TIMES
${slotLines(payload)}

HAIRCUT / COMMENTS
  ${display(payload.description)}

The block below is this request in machine-readable form, kept so the row can
be rebuilt if it never reached the sheet. Leave it alone.

${serializeBookingBlock(payload)}
`;

  return { subject, text, html };
}
