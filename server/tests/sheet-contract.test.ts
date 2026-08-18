/*
 * The A..L sheet contract, tested end to end.
 *
 * This used to run the jsCode out of a committed n8n workflow export against
 * notification emails, because a workflow polling Gmail was what turned a
 * booking into a row. The server writes the row itself now, so the contract is
 * two functions in one module and the test can close the loop properly: build a
 * row from a booking, hand it back through the reader, and check the request
 * that comes out is the one that went in.
 *
 * That round trip is the point. Column order is not written down anywhere else,
 * and getting it wrong does not throw, it just puts a phone number where an
 * email should be.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ISheetsClient, Worker as AppointmentsWorker, buildSheetRow
} from "../src/Appointments";
import { buildBookingPayload, parseBookingBlock } from "../src/Booking";
import { renderOwnerNotification } from "../src/BookingEmails";
import type { IServerInfo } from "../src/ServerInfo";
import type { IValidatedBooking } from "../src/Booking";
import {
  COLUMN_KEYS,
  SUBMITTED_AT,
  SUBMITTED_DATE_LA,
  SUBMITTED_TIME_LA,
  singleSlotBooking,
  validBooking
} from "./fixtures";

const serverInfo = {
  smtp: { host: "smtp.example", port: 465, auth: { user: "owner@example.com", pass: "x" } },
  imap: { host: "imap.example", port: 993, auth: { user: "owner@example.com", pass: "x" } },
  sheets: { spreadsheetId: "sheet-id", range: "Sheet1!A:L" }
} as IServerInfo;

/* A sheet in memory. Rows land in the same shape Google hands back: a header
   row first, then the bookings, newest under the header. */
class FakeSheet implements ISheetsClient {
  public rows: any[][] = [COLUMN_KEYS.slice()];
  public writes: { spreadsheetId: string, range: string }[] = [];

  public async read(): Promise<any[][]> { return this.rows; }

  public async insertTopRow(
    spreadsheetId: string, range: string, row: string[]
  ): Promise<void> {
    this.writes.push({ spreadsheetId, range });
    this.rows.splice(1, 0, row);
  }
}

const rowFor = (booking: IValidatedBooking = validBooking): string[] =>
  buildSheetRow(buildBookingPayload(booking, SUBMITTED_AT));

describe("buildSheetRow", () => {

  it("produces the twelve columns in A..L order", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    expect(Object.keys(payload)).toEqual(COLUMN_KEYS);
    expect(buildSheetRow(payload)).toEqual(Object.values(payload));
  });

  it("carries the America/Los_Angeles timestamp into columns B and C", () => {
    const row = rowFor();
    expect(row[1]).toBe(SUBMITTED_DATE_LA);
    expect(row[2]).toBe(SUBMITTED_TIME_LA);
  });

  it("keeps N/A for slots the client skipped", () => {
    const row = rowFor(singleSlotBooking);
    expect([row[6], row[7], row[8], row[9]]).toEqual(["N/A", "N/A", "N/A", "N/A"]);
  });

  it("puts the email in column L", () => {
    expect(rowFor()[11]).toBe(validBooking.email);
  });

  it("passes awkward text through untouched", () => {
    /* Quotes, an apostrophe, a newline, and text that looks like the labels the
       old EmailJS emails used. None of it is parsed any more, and none of it
       should be escaped or trimmed on the way to a cell. */
    const booking: IValidatedBooking = {
      ...validBooking,
      name: 'Renée "Ren" O\'Brien-Smith',
      availability1: "Phone #: 555, Preferred Date 1: whenever",
      description: "Skin fade <no eyebrows> & a line-up\nSecond line. Best wishes"
    };
    const row = rowFor(booking);
    expect(row[0]).toBe(booking.name);
    expect(row[5]).toBe(booking.availability1);
    expect(row[10]).toBe(booking.description);
  });

  it("handles a maximum-length description", () => {
    const description = "A ".repeat(999) + "end";
    expect(rowFor({ ...validBooking, description })[10]).toBe(description);
  });

});

describe("a row written and read back", () => {

  const roundTrip = async (booking: IValidatedBooking = validBooking) => {
    const sheet = new FakeSheet();
    const worker = new AppointmentsWorker(serverInfo, sheet);
    await worker.appendAppointment(buildBookingPayload(booking, SUBMITTED_AT));
    const [request] = await worker.listAppointments();
    return { sheet, request };
  };

  it("comes back as the booking that went in", async () => {
    const { request } = await roundTrip();
    expect(request).toEqual({
      name: validBooking.name,
      submittedDate: SUBMITTED_DATE_LA,
      submittedTime: SUBMITTED_TIME_LA,
      phone: validBooking.phone,
      preferred: [
        { date: validBooking.date1, availability: validBooking.availability1 },
        { date: validBooking.date2, availability: validBooking.availability2 },
        { date: validBooking.date3, availability: validBooking.availability3 }
      ],
      notes: validBooking.description,
      email: validBooking.email
    });
  });

  it("drops the skipped slots rather than showing them as N/A", async () => {
    const { request } = await roundTrip(singleSlotBooking);
    expect(request?.preferred).toEqual([
      { date: singleSlotBooking.date1, availability: singleSlotBooking.availability1 }
    ]);
  });

  it("writes to the configured spreadsheet and range", async () => {
    const { sheet } = await roundTrip();
    expect(sheet.writes).toEqual([
      { spreadsheetId: "sheet-id", range: "Sheet1!A:L" }
    ]);
  });

  it("puts the newest booking directly under the header", async () => {
    const sheet = new FakeSheet();
    const worker = new AppointmentsWorker(serverInfo, sheet);

    for (const name of ["First", "Second", "Third"]) {
      await worker.appendAppointment(
        buildBookingPayload({ ...validBooking, name }, SUBMITTED_AT));
    }

    /* The sheet itself reads newest-first, so opening it on a phone shows the
       latest request without scrolling to the bottom. */
    expect(sheet.rows.slice(1).map((row) => row[0])).toEqual(["Third", "Second", "First"]);
    /* And the dashboard hands them over in the same order, no reversal. */
    expect((await worker.listAppointments()).map((request) => request.name))
      .toEqual(["Third", "Second", "First"]);
  });

  it("keeps a phone number that starts with a plus as text", async () => {
    /* A leading + is why rows pasted by hand turned into #ERROR!: Sheets reads
       it as a formula unless the write says RAW. */
    const { request } = await roundTrip({ ...validBooking, phone: "+1 669-265-9699" });
    expect(request?.phone).toBe("+1 669-265-9699");
  });

  it("refuses to append when no sheet is configured", async () => {
    const worker = new AppointmentsWorker(
      { ...serverInfo, sheets: undefined } as IServerInfo, new FakeSheet());
    await expect(worker.appendAppointment(buildBookingPayload(validBooking, SUBMITTED_AT)))
      .rejects.toThrow(/not configured/);
  });

});

/*
 * The JSON block in the owner notification is no longer parsed by anything on
 * the request path. It stays because it is the only machine-readable copy of a
 * booking outside the sheet, so a request whose append failed can be recovered
 * from the mailbox instead of retyped off the screen.
 */
describe("the recovery copy in the owner email", () => {

  it("round-trips a booking through the email body", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const email = renderOwnerNotification(payload, validBooking.email);
    expect(parseBookingBlock(email.text)).toEqual(payload);
  });

  it("rebuilds the same sheet row the append would have written", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const email = renderOwnerNotification(payload, validBooking.email);
    expect(buildSheetRow(parseBookingBlock(email.text))).toEqual(buildSheetRow(payload));
  });

  it("keeps the subject prefix the mailbox is searched by", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    expect(renderOwnerNotification(payload, validBooking.email).subject)
      .toMatch(/^Appointment Request from /);
  });

});

/*
 * The range Appointments.ts asks Google for has to reach the last column that
 * gets written. This is here because getting it wrong fails silently:
 * requesting A:K from a sheet holding twelve columns returns eleven, the reader
 * finds nothing at row[11], and the field never appears. No error, no log line,
 * nothing to search for. The email column shipped with the config still pinned
 * to A:K and looked, from the dashboard, exactly like a bug in the code.
 */
describe("the configured sheet range", () => {

  /* "Sheet1!A:L" -> "L" */
  const endColumn = (range: string): string =>
    (range.split("!").pop() ?? "").split(":").pop() ?? "";

  const columnNumber = (letter: string): number =>
    letter.toUpperCase().charCodeAt(0) - 64;

  it("reaches at least as far right as the last column written", () => {
    const example = JSON.parse(fs.readFileSync(
      path.join(__dirname, "../serverInfo.example.json"), "utf8"
    ));

    const end = endColumn(example.sheets.range);
    expect(columnNumber(end)).toBeGreaterThanOrEqual(COLUMN_KEYS.length);
  });

});
