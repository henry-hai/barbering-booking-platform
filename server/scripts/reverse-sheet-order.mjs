/*
 * Flips the booking sheet from oldest-first to newest-first, once.
 *
 * The sheet was written oldest-first for as long as an n8n workflow appended to
 * it, and the dashboard reversed it on read. That was invisible on the
 * dashboard and awkward everywhere else: opening the sheet on a phone put the
 * newest request at the bottom, past a hundred rows of history.
 *
 * Appointments.ts now inserts each booking under the header instead, so the
 * sheet reads the same way the dashboard does. The rows already in it still
 * need turning around, which is what this does.
 *
 * Run it once, after the server that writes newest-first is deployed. Running
 * it against the old server would leave the dashboard showing the oldest
 * request first until the deploy caught up. Running it twice puts the sheet
 * back the way it started, so check the output rather than guessing.
 *
 * The header is left alone and no cell is edited, only reordered. A copy of the
 * sheet as it was is written next to this script first.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(path.join(HERE, "../serverInfo.json"), "utf8"));

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(HERE, "../serviceAccount.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = info.sheets.spreadsheetId;
const range = info.sheets.range;

const before = await sheets.spreadsheets.values.get({ spreadsheetId, range });
const rows = before.data.values || [];
if (rows.length <= 2) {
  console.log("Nothing to reorder.");
  process.exit(0);
}

const header = rows[0];
const data = rows.slice(1);

/* Column B is the submitted date, so this reports which way round the sheet is
   without having to open it. It is a report rather than a check: two rows from
   the same day are common and prove nothing either way. */
const describe = (list) =>
  `${list[0]?.[1] ?? "?"} at the top, ${list[list.length - 1]?.[1] ?? "?"} at the bottom`;

const backup = path.join(HERE, "sheet-before-reverse.json");
fs.writeFileSync(backup, JSON.stringify(rows, null, 1));

console.log(`${data.length} rows: ${describe(data)}`);

const reversed = data.slice().reverse();

/* Every cell is written back as a string. Left to itself Sheets would read a
   phone number beginning with + as a formula and store #ERROR!. */
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range,
  valueInputOption: "RAW",
  requestBody: { values: [header, ...reversed] }
});

const after = await sheets.spreadsheets.values.get({ spreadsheetId, range });
const written = (after.data.values || []).slice(1);

console.log(`now:        ${describe(written)}`);
console.log(`rows before ${data.length}, rows after ${written.length}`);
console.log(`copy of the original: ${backup}`);

if (written.length !== data.length) {
  console.error("Row count changed. Restore from the copy above.");
  process.exit(1);
}
