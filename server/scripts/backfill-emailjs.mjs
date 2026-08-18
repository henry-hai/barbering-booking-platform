/*
 * One-off import of the booking history that predates the current server.
 *
 * Before August 2026 the booking form went through EmailJS, which mailed a
 * plain-text summary to the owner and stored nothing. Those emails are the only
 * record of roughly two years of appointments, so this reads them straight out
 * of Gmail over IMAP and turns them into sheet rows.
 *
 * EmailJS was reconfigured partway through, so there are two shapes to handle:
 *
 *   V1 (May 2024 to Oct 2024) had one free-text "Dates:" box. People wrote
 *   things like "Monday June 3rd 6-9 pm, Friday June 7th 4-5 pm". There is no
 *   structure to recover, so the dates are pulled out where they can be read
 *   confidently and the original text is kept verbatim in the availability
 *   column. Nothing is discarded.
 *
 *   V2 (Nov 2024 onward) had the three date/availability pairs the form still
 *   uses, so it maps across directly.
 *
 * Run it with no arguments to write a TSV for review. Run it with --apply to
 * put the rows into the sheet. The sheet is newest-first, and everything here
 * predates every row already in it, so they go on the bottom.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { google } from "googleapis";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_INFO = path.join(HERE, "../serverInfo.json");
const KEY_FILE = path.join(HERE, "../serviceAccount.json");

/* The subject line has never changed, which is the only reliable way to find
   these among 20,000 other messages. It also matches the current server's
   owner notifications, so the era check below does the real filtering. */
const SUBJECT = "Appointment Request from";

/* The current server wraps a JSON block in these. Their presence means the mail
   came from the server, not EmailJS, and is therefore already in the sheet. */
const SERVER_MARKER = "---BOOKING_JSON_START---";

/*
 * Two V1 requests describe their days in words with no date anywhere in them,
 * so nothing can be read out mechanically. Henry resolved both against the
 * calendar for the week each one was sent, and the client's original wording
 * still goes in the availability column beside them.
 *
 *   Patrick, sent Sunday 16 Jun 2024: "next week ... Monday, Tuesday, Saturday"
 *   Randy, sent Monday 5 Aug 2024: "weekdays after 4:00PM. Any time on the
 *   weekends", taken as the first two weekdays and the first weekend after.
 */
/*
 * Corrections Henry made on review. Kevin spelled his own name wrong and left a
 * digit out of his phone number, and he has booked since under the right ones.
 */
const CORRECTIONS = {
  "Kevin Truing": { name: "Kevin Truong", phone: "4084933924" }
};

/*
 * Submissions Henry made himself while testing the old form. They give
 * themselves away by the phone number: 408-123-4567, a 3-digit 911, or an
 * 8-digit number that was never dialable. Four of them went out in one sitting
 * on 27 Nov 2024 under different names but the same placeholder number, all
 * asking for a bald fade.
 *
 * They are imported by default. They are still real submissions the form took,
 * they pad the dashboard out to a useful size, and any of them can be deleted
 * from the sheet later. Pass --drop-tests to leave them out instead.
 */
const TEST_SUBMISSIONS = new Set([
  "Dana Black", "Wolverine 5", "Wolverine 7", "sadfd", "Kobe", "Kobe Bryant",
  "Jiri Procha", "Brian Campbell", "neemoy"
]);

const RESOLVED_BY_HAND = {
  "Patrick Harley Dizon|2024-06-16": ["2024-06-17", "2024-06-18", "2024-06-22"],
  "Randy Herradura|2024-08-05": ["2024-08-06", "2024-08-07", "2024-08-10"]
};

const MONTHS = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday"];

/* EmailJS writes "Not provided" where the client left a box empty. The sheet
   already uses "N/A" for that, and the dashboard treats it as blank, so the
   placeholder is dropped rather than carried through as if it were an answer. */
const PLACEHOLDER = /^(not provided|none|n\/a)$/i;

/* Where a field's value ends: a blank line, or the next label.
 *
 * This has to be a lookahead rather than a match to end of line. Plain-text
 * mail is hard-wrapped near 76 characters, so a long answer arrives split
 * across lines with no indication that it was one sentence. Reading only the
 * first line quietly drops the rest, which cost nine answers their tails
 * before this was caught. */
const VALUE_END =
  /(?=\n[ \t]*\n|\n(?:Preferred Date|Availability for|Description of|Best wishes))/;

const labelled = (text, label) => {
  const pattern = new RegExp(
    label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + ":[ \t]*([\\s\\S]*?)" + VALUE_END.source);
  const match = text.match(pattern);
  /* Wrapped lines rejoin with a space, since the break was the transport's
     doing and not something the client typed. */
  const value = match ? match[1].replace(/\s*\n\s*/g, " ").trim() : "";
  return PLACEHOLDER.test(value) ? "" : value;
};

const field = (text, pattern) => {
  const match = text.match(pattern);
  const value = match ? match[1].trim() : "";
  return PLACEHOLDER.test(value) ? "" : value;
};

/* Matches how the running server writes columns B and C, so imported rows are
   indistinguishable from ones the booking endpoint creates. */
const submittedAt = (when) => ({
  date: when.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }),
  time: when.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit" })
});

/*
 * Pulls dates out of a free-text V1 blob.
 *
 * Two forms show up: a month name with an optional ordinal ("June 3rd",
 * "august 4th") and a numeric pair with an optional year ("6/3", "8/29/24",
 * and "6/21st", which someone typed with the ordinal stuck on).
 *
 * Nobody wrote a year in the month-name form, so the year is taken from the
 * date the email arrived. A request can name a date in the next calendar year,
 * so anything landing more than a month before the email rolls forward.
 *
 * Where the client also named a weekday, it is checked against the real
 * calendar. A mismatch does not drop the date, it flags the row for review,
 * because a client misremembering a weekday is more likely than a bad parse.
 */
function extractDates(blob, receivedAt) {
  const anchor = receivedAt.getTime();
  const year = receivedAt.getUTCFullYear();
  const hits = [];

  const record = (y, monthIndex, day, at, matched) => {
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) { return; }
    let when = new Date(Date.UTC(y, monthIndex, day));
    if (when.getTime() < anchor - 31 * 86400000) {
      when = new Date(Date.UTC(y + 1, monthIndex, day));
    }
    if (when.getUTCMonth() !== ((monthIndex + 12) % 12)) { return; }
    hits.push({ iso: when.toISOString().slice(0, 10),
      weekday: WEEKDAYS[when.getUTCDay()], at, matched });
  };

  for (const m of blob.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    record(year, MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]), m.index, m[0]);
  }
  for (const m of blob.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:st|nd|rd|th)?\b/g)) {
    const explicit = m[3]
      ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]))
      : year;
    record(explicit, Number(m[1]) - 1, Number(m[2]), m.index, m[0]);
  }

  /* A client naming the same day twice, or writing "8/10/24" so both the
     month-name and numeric patterns fire, should not produce two slots. */
  const unique = [];
  for (const hit of hits.sort((a, b) => a.at - b.at)) {
    if (!unique.some((u) => u.iso === hit.iso)) { unique.push(hit); }
  }

  /* Look just behind each date for a weekday the client typed themselves. */
  const conflicts = [];
  for (const hit of unique) {
    const lead = blob.slice(Math.max(0, hit.at - 18), hit.at).toLowerCase();
    const stated = WEEKDAYS.find((day) => lead.includes(day));
    if (stated && stated !== hit.weekday) {
      conflicts.push(`${hit.matched} reads ${stated}, ${hit.iso} was a ${hit.weekday}`);
    }
  }

  return { dates: unique.slice(0, 3).map((u) => u.iso), conflicts };
}

/* Turns one email into the twelve columns the sheet holds, A through L. */
function toRow(mail) {
  const text = (mail.text || "").replace(/\r/g, "");
  const submitted = field(mail.subject || "", /^Appointment Request from (.+)$/);
  const correction = CORRECTIONS[submitted];
  const name = correction ? correction.name : submitted;
  const stamp = submittedAt(mail.date);
  const phone = correction ? correction.phone : labelled(text, "Phone #");
  const structured = /Preferred Date 1:/.test(text);

  if (structured) {
    return { version: 2, name, raw: "", conflicts: [], columns: [
      name, stamp.date, stamp.time, phone,
      labelled(text, "Preferred Date 1"), labelled(text, "Availability for Date 1"),
      labelled(text, "Preferred Date 2"), labelled(text, "Availability for Date 2"),
      labelled(text, "Preferred Date 3"), labelled(text, "Availability for Date 3"),
      field(text, /Description of Haircut \/ Other Comments:\s*\n([\s\S]*?)\n\nBest wishes/),
      ""
    ] };
  }

  /* V1. The blob is a single cell, so its line breaks collapse to spaces. It
     goes in the first availability column whether or not a date was readable,
     which is what makes this lossless. */
  const blob = field(text, /Dates:[ \t]*([\s\S]*?)\n\nBest wishes/).replace(/\s*\n\s*/g, " ").trim();
  const manual = RESOLVED_BY_HAND[`${name}|${mail.date.toISOString().slice(0, 10)}`];
  const { dates, conflicts } = manual
    ? { dates: manual, conflicts: [] }
    : extractDates(blob, mail.date);
  return { version: 1, name, raw: blob, conflicts, columns: [
    name, stamp.date, stamp.time, phone,
    dates[0] || "", blob,
    dates[1] || "", "",
    dates[2] || "", "",
    "", ""
  ] };
}

async function readMailbox(info) {
  const client = new ImapFlow({
    host: info.imap.host, port: info.imap.port, secure: true,
    auth: info.imap.auth, logger: false
  });
  await client.connect();
  const collected = [];
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const uids = await client.search({ header: { subject: SUBJECT } }, { uid: true });
    for await (const message of client.fetch(uids, { source: true }, { uid: true })) {
      collected.push(await simpleParser(message.source));
    }
  } finally {
    await client.logout();
  }
  return collected;
}

function build(mails, dropTests) {
  const skipped = { serverEra: 0, noName: 0, duplicate: 0, empty: 0, test: 0 };

  const historical = mails.filter((mail) => {
    if ((mail.text || "").includes(SERVER_MARKER)) { skipped.serverEra++; return false; }
    /* Three submissions in Nov 2024 came through with the name box empty. There
       is no client to attribute them to, so they are left out. */
    if (!/^Appointment Request from .+$/.test(mail.subject || "")) { skipped.noName++; return false; }
    return true;
  });

  historical.sort((a, b) => a.date - b.date);

  /* Every duplicate in this mailbox is the same request arriving twice in the
     same minute, which is a double-tap on the submit button. Including the
     timestamp in the key keeps a genuine repeat booking weeks later. */
  const seen = new Set();
  const rows = [];
  for (const mail of historical) {
    const row = toRow(mail);
    /* Two submissions came through with the dates box empty and nothing else to
       go on, so there is no appointment to record. */
    if (!row.columns[4] && !row.columns[5]) { skipped.empty++; continue; }
    if (dropTests && TEST_SUBMISSIONS.has(row.name)) { skipped.test++; continue; }
    const key = [row.name, row.columns[3], mail.date.toISOString().slice(0, 16)].join("|");
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    rows.push({ ...row, receivedAt: mail.date });
  }
  return { rows, skipped };
}

function writeReview(rows, destination) {
  const header = ["#", "version", "flag", "A name", "B date", "C time", "D phone",
    "E date1", "F avail1", "G date2", "H avail2", "I date3", "J avail3",
    "K notes", "L email", "RAW original text"];
  const lines = [header.join("\t")];
  rows.forEach((row, index) => {
    const cell = (value) => String(value ?? "").replace(/\t/g, " ").replace(/\n/g, " ");
    lines.push([index + 1, `V${row.version}`,
      row.conflicts.length ? "CHECK" : "",
      ...row.columns.map(cell), cell(row.raw)].join("\t"));
  });
  fs.writeFileSync(destination, lines.join("\n"));
}

async function apply(rows, info) {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = info.sheets.spreadsheetId;

  const before = await sheets.spreadsheets.values.get({ spreadsheetId, range: info.sheets.range });
  const existing = (before.data.values || []).length;

  /* Oldest first within the batch, appended below everything already there, so
     the sheet stays in one continuous newest-to-oldest order.

     RAW keeps Sheets from reading a leading + on a phone number as a formula,
     which is what produced the #ERROR! cells when rows were pasted by hand. */
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: info.sheets.range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows.map((r) => r.columns).reverse() }
  });

  const after = await sheets.spreadsheets.values.get({ spreadsheetId, range: info.sheets.range });
  return { existing: existing - 1, added: rows.length, total: (after.data.values || []).length - 1 };
}

const info = JSON.parse(fs.readFileSync(SERVER_INFO, "utf8"));
const mails = await readMailbox(info);
const dropTests = process.argv.includes("--drop-tests");
const { rows, skipped } = build(mails, dropTests);

console.log(`found ${mails.length} messages matching "${SUBJECT}"`);
console.log(`  skipped ${skipped.serverEra} from the current server, already in the sheet`);
console.log(`  skipped ${skipped.noName} submitted without a name`);
console.log(`  skipped ${skipped.duplicate} duplicate submissions`);
console.log(`  skipped ${skipped.empty} submitted with no dates at all`);
console.log(dropTests
  ? `  skipped ${skipped.test} test submissions`
  : `  kept ${[...TEST_SUBMISSIONS].length} names worth of test submissions, pass --drop-tests to leave them out`);
console.log(`  ${rows.length} rows to import`);
console.log(`  V1 ${rows.filter((r) => r.version === 1).length}, V2 ${rows.filter((r) => r.version === 2).length}`);

const flagged = rows.filter((r) => r.conflicts.length);
if (flagged.length) {
  console.log(`\n${flagged.length} flagged for review:`);
  for (const row of flagged) { console.log(`  ${row.name}: ${row.conflicts.join("; ")}`); }
}

const noDate = rows.filter((r) => r.version === 1 && !r.columns[4]);
if (noDate.length) {
  console.log(`\n${noDate.length} V1 rows with no readable date, original text kept in column F:`);
  for (const row of noDate) { console.log(`  ${row.name}: ${JSON.stringify(row.raw)}`); }
}

if (process.argv.includes("--apply")) {
  const result = await apply(rows, info);
  console.log(`\nadded ${result.added} rows below the existing ${result.existing}, sheet now holds ${result.total}`);
} else {
  const destination = process.argv[2] || path.join(HERE, "backfill-review.tsv");
  writeReview(rows, destination);
  console.log(`\nreview file: ${destination}`);
  console.log("nothing written to the sheet. rerun with --apply once the file looks right.");
}
