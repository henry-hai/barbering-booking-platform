import type {
  IAppointmentLog, IBookingPayload, IValidatedBooking
} from "../src/Booking";

/* 19:30 UTC is 12:30 PDT, which makes the America/Los_Angeles conversion in the
   timestamp visible rather than a no-op. */
export const SUBMITTED_AT = new Date("2026-08-01T19:30:00Z");
export const SUBMITTED_DATE_LA = "8/1/2026";
export const SUBMITTED_TIME_LA = "12:30 PM";

/* Sheet columns A..L, in order. The order itself is the contract. */
export const COLUMN_KEYS = [
  "name", "date", "time", "phone",
  "date1", "avail1", "date2", "avail2", "date3", "avail3",
  "description", "email"
];

export const validBody = {
  name: "Jordan Reyes",
  email: "jordan@example.com",
  phone: "(408) 555-0147",
  date1: "2026-08-05",
  availability1: "After 4pm",
  date2: "2026-08-07",
  availability2: "Mornings only",
  date3: "2026-08-09",
  availability3: "Any time Saturday",
  description: "Mid fade, scissor top, beard line-up",
  policiesAccepted: true
};

export const validBooking: IValidatedBooking = {
  name: validBody.name,
  email: validBody.email,
  phone: validBody.phone,
  date1: validBody.date1,
  availability1: validBody.availability1,
  date2: validBody.date2,
  availability2: validBody.availability2,
  date3: validBody.date3,
  availability3: validBody.availability3,
  description: validBody.description
};

/* Only the first slot filled, which is the common case. */
export const singleSlotBooking: IValidatedBooking = {
  ...validBooking,
  date2: "", availability2: "", date3: "", availability3: ""
};

/*
 * Records rows instead of writing them.
 *
 * Every test that submits a booking passes one of these in. Without it a test
 * builds the real Sheets client and, if the fixture happens to carry a sheets
 * block, sends a request to Google from the suite.
 */
export class RecordingLog implements IAppointmentLog {
  public rows: IBookingPayload[] = [];
  public async appendAppointment(payload: IBookingPayload): Promise<void> {
    this.rows.push(payload);
  }
}
