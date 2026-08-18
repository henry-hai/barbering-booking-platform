/*
 * The booking log in Google Sheets, read and written.
 *
 * The sheet is the single source of truth for appointments: the dashboard reads
 * it live and Henry works off it on his phone. This module owns both ends of
 * that, the A..L column order in buildSheetRow() and the mapping back into
 * IBookingRequest in listAppointments(), so the two can never drift apart.
 *
 * Rows are newest-first. A booking is inserted directly under the header rather
 * than appended, which costs nothing and means the sheet reads the same way the
 * dashboard does. Appending instead would put the newest request 122 rows down,
 * where it is no use to anyone opening the sheet on a phone.
 *
 * Rows used to be written by an n8n workflow that polled Gmail for the owner
 * notification and parsed a JSON block back out of it. That was a round trip
 * through email for data this server already had in hand, and it meant the log
 * only worked while a workflow was running somewhere. Booking.ts writes the row
 * directly now and the email is only an email.
 */

import path from "path";
import { google } from "googleapis";
import { IServerInfo } from "./ServerInfo";
import type { IBookingPayload } from "./Booking";

/* A single preferred slot the client offered (one of up to three). */
export interface IPreferredSlot { date: string, availability: string }

/* One booking request, normalized from a sheet row. */
export interface IBookingRequest {
  name: string,
  submittedDate: string,
  submittedTime: string,
  phone: string,
  preferred: IPreferredSlot[],
  notes: string,
  /* Column L, appended after A..K were already in use. Rows written before it
     existed have nothing there, so this is "" for them rather than missing. */
  email: string
}

/* Service account key file. Gitignored; the user drops their downloaded
   key here. Resolved relative to server/ (one level up from dist/). */
const KEY_PATH = path.join(__dirname, "../serviceAccount.json");

/* Trims a cell and treats the historical "N/A" placeholder as empty. Rows
   written before this module owned the format use it for an unanswered field,
   and the dashboard should show those the same as a blank cell. */
const clean = (value: any): string => {
  const s = (value === undefined || value === null) ? "" : String(value).trim();
  return s === "N/A" ? "" : s;
};

/*
 * One booking as the twelve cells of a sheet row, A through L.
 *
 * The order is the contract. listAppointments() reads it back by index and
 * every row written since May 2024 is in this shape, so a column cannot be
 * reordered or inserted without rewriting the whole sheet.
 */
export function buildSheetRow(payload: IBookingPayload): string[] {
  return [
    payload.name, payload.date, payload.time, payload.phone,
    payload.date1, payload.avail1,
    payload.date2, payload.avail2,
    payload.date3, payload.avail3,
    payload.description, payload.email
  ];
}

/*
 * The slice of the Sheets API this module uses.
 *
 * Narrow on purpose: it is what lets the tests hand in a recorder instead of
 * standing up a fake Google, the same way IMailer does for outbound email.
 */
export interface ISheetsClient {
  read(spreadsheetId: string, range: string): Promise<any[][]>;
  /* Inserts directly under the header, pushing everything else down. */
  insertTopRow(spreadsheetId: string, range: string, row: string[]): Promise<void>;
}

/* "Sheet1!A:L" -> "Sheet1". A range with no sheet name means the first tab. */
const sheetTitle = (range: string): string =>
  range.includes("!") ? (range.split("!")[0] ?? "").replace(/^'|'$/g, "") : "";

/* The real client. One scope covers both directions, so the service account
   needs Editor on the sheet rather than Viewer. */
function googleSheetsClient(): ISheetsClient {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const sheets = google.sheets({ version: "v4", auth });

  /* Row operations address a tab by its numeric id, not the name in the range,
     and the two are unrelated. Looked up rather than assumed to be 0: guessing
     wrong writes to a different tab, which loses nothing but shows up as
     bookings that never arrive, with no error anywhere. */
  const sheetIds = new Map<string, number>();

  const resolveSheetId = async (spreadsheetId: string, range: string): Promise<number> => {
    const title = sheetTitle(range);
    const cacheKey = `${spreadsheetId}!${title}`;
    const cached = sheetIds.get(cacheKey);
    if (cached !== undefined) { return cached; }

    const meta = await sheets.spreadsheets.get({
      spreadsheetId, fields: "sheets.properties(sheetId,title,index)"
    });
    const tabs = meta.data.sheets ?? [];
    const match = title === ""
      ? tabs.find((tab) => tab.properties?.index === 0)
      : tabs.find((tab) => tab.properties?.title === title);

    const id = match?.properties?.sheetId;
    if (id === undefined || id === null) {
      throw new Error(`No tab named "${title}" in the booking sheet.`);
    }
    sheetIds.set(cacheKey, id);
    return id;
  };

  return {
    async read(spreadsheetId, range) {
      const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      return response.data.values || [];
    },

    async insertTopRow(spreadsheetId, range, row) {
      const sheetId = await resolveSheetId(spreadsheetId, range);

      /* Both halves in one batchUpdate so there is never a moment where the
         sheet holds a blank row. */
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
                inheritFromBefore: false
              }
            },
            {
              updateCells: {
                start: { sheetId, rowIndex: 1, columnIndex: 0 },
                /* stringValue, never a formula. A phone number written
                   "+1 669..." is text, and letting Sheets parse it stores
                   #ERROR! instead, which is what pasting rows by hand did. */
                rows: [{ values: row.map((cell) => ({
                  userEnteredValue: { stringValue: cell }
                })) }],
                fields: "userEnteredValue"
              }
            }
          ]
        }
      });
    }
  };
}

export class Worker {

  private static serverInfo: IServerInfo;
  private sheets: ISheetsClient;

  constructor(inServerInfo: IServerInfo, inSheets?: ISheetsClient) {
    Worker.serverInfo = inServerInfo;
    /* Built lazily by default: constructing GoogleAuth reads the key file, and
       nothing should touch the filesystem just to instantiate a Worker. */
    this.sheets = inSheets ?? googleSheetsClient();
  }

  /* Fetches all booking requests from the configured sheet, newest first.
     Returns [] if no sheets config is present or the sheet is empty. */
  public async listAppointments(): Promise<IBookingRequest[]> {
    const sheetsConfig = Worker.serverInfo.sheets;
    if (!sheetsConfig || !sheetsConfig.spreadsheetId) { return []; }

    const rows = await this.sheets.read(sheetsConfig.spreadsheetId, sheetsConfig.range);
    if (rows.length <= 1) { return []; }

    /* Row 0 is the header; map the rest by the fixed 12-column order of
       buildSheetRow (A..L). Sheets truncates trailing empty cells, so a row
       written before column L existed simply has no index 11 and clean()
       turns that into "". */
    const requests: IBookingRequest[] = rows.slice(1).map((row) => {
      const preferred: IPreferredSlot[] = [
        { date: clean(row[4]), availability: clean(row[5]) },
        { date: clean(row[6]), availability: clean(row[7]) },
        { date: clean(row[8]), availability: clean(row[9]) }
      ].filter((slot) => slot.date !== "" || slot.availability !== "");

      return {
        name: clean(row[0]),
        submittedDate: clean(row[1]),
        submittedTime: clean(row[2]),
        phone: clean(row[3]),
        preferred: preferred,
        notes: clean(row[10]),
        email: clean(row[11])
      };
    });

    /* The sheet is already newest-first: every booking is inserted directly
       under the header, so row order is display order. */
    return requests;
  }

  /* Records one booking at the top of the sheet, so the newest request is the
     first row under the header whether it is being read by the dashboard or by
     Henry on his phone. Throws if there is no sheets config, because a booking
     that is not recorded anywhere is a failure the caller has to know about
     rather than swallow. */
  public async appendAppointment(payload: IBookingPayload): Promise<void> {
    const sheetsConfig = Worker.serverInfo.sheets;
    if (!sheetsConfig || !sheetsConfig.spreadsheetId) {
      throw new Error("No sheets config: the booking log is not configured.");
    }

    await this.sheets.insertTopRow(
      sheetsConfig.spreadsheetId, sheetsConfig.range, buildSheetRow(payload));
  }

}
