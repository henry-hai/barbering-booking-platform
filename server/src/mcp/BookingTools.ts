/*
 * The behaviour behind the MCP tools.
 *
 * Nothing here reimplements a booking rule. check_availability reads the sheet
 * through the same Appointments.Worker the dashboard uses, and request_booking
 * runs the exact path POST /booking runs: the same honeypot check, the same
 * rate limiter, the same validateBooking, and the same Booking.Worker, which
 * emits the same owner notification carrying the same sentinel-wrapped A..L
 * JSON kept for recovery. A booking made through MCP is
 * indistinguishable downstream from one made on the website.
 *
 * The SDK is deliberately absent from this file. Keeping the tool logic free
 * of transport concerns is what lets the tests drive it directly with a
 * recording mailer and a stubbed sheet, offline and with no secrets.
 */

import { IServerInfo } from "../ServerInfo";
import * as Appointments from "../Appointments";
import * as Booking from "../Booking";
import { RateLimiter } from "../RateLimit";

/* The slice of Appointments.Worker these tools need, so tests can supply a
   stub instead of reaching Google. Both directions, because request_booking
   writes a row and check_availability reads them: a seam that covered only
   reads would leave the write reaching the real API from a test. */
export interface IAppointmentsSheet extends Booking.IAppointmentLog {
  listAppointments(): Promise<Appointments.IBookingRequest[]>;
}

export interface IBookingToolsOptions {
  /* Injected in tests to record messages instead of sending them. */
  mailer?: Booking.IMailer;
  /* Injected in tests to stand in for the Google Sheet. */
  appointments?: IAppointmentsSheet;
  /* Same defaults as the HTTP endpoint. */
  perCallerLimit?: number;
  windowMs?: number;
}

/* Inclusive ISO bounds, YYYY-MM-DD. Both optional, and both spelled with an
   explicit undefined: exactOptionalPropertyTypes is on, and a client that
   omits an argument hands it over as undefined rather than leaving it out. */
export interface IAvailabilityQuery {
  from?: string | undefined;
  to?: string | undefined;
}

/* One date clients have already asked for, and how heavily. */
export interface IRequestedDate {
  date: string;
  /* How many pending requests name this date among their preferred slots. */
  requestCount: number;
  /* The availability notes given alongside it, for reading at a glance. */
  notes: string[];
}

export interface IAvailabilityResult {
  /* Echoes the window actually applied. */
  from: string | null;
  to: string | null;
  /* Total pending requests on the sheet, before the window is applied. */
  totalRequests: number;
  requestedDates: IRequestedDate[];
}

export interface IBookingToolResult {
  ok: boolean;
  message: string;
  /* Field name -> message, when validation rejected the input. */
  errors?: Record<string, string>;
  /* The eleven columns exactly as they were written, when it succeeded. */
  row?: Booking.IBookingPayload;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ISO dates sort correctly as strings, so the window needs no date parsing. */
const withinWindow = (
  date: string,
  from: string | null,
  to: string | null
): boolean => {
  if (from !== null && date < from) { return false; }
  if (to !== null && date > to) { return false; }
  return true;
};

export class BookingTools {

  private serverInfo: IServerInfo;
  private options: IBookingToolsOptions;
  private limiter: RateLimiter;

  constructor(inServerInfo: IServerInfo, options: IBookingToolsOptions = {}) {
    this.serverInfo = inServerInfo;
    this.options = options;
    this.limiter = new RateLimiter(
      options.perCallerLimit ?? 5,
      options.windowMs ?? 10 * 60 * 1000
    );
  }

  private sheet(): IAppointmentsSheet {
    return this.options.appointments ??
      new Appointments.Worker(this.serverInfo);
  }

  /*
   * Reports which dates already have booking requests against them.
   *
   * Worth being precise about what this can and cannot tell you. The sheet
   * holds requests, not a confirmed calendar: a date appearing here means
   * someone has asked for it, not that it is taken, and a date absent from
   * here is not a promise that it is free. It is the same picture the
   * dashboard shows, which is the only booking data this system has.
   */
  public async checkAvailability(
    query: IAvailabilityQuery = {}
  ): Promise<IAvailabilityResult> {
    const from = ISO_DATE.test(query.from ?? "") ? (query.from as string) : null;
    const to = ISO_DATE.test(query.to ?? "") ? (query.to as string) : null;

    const requests = await this.sheet().listAppointments();

    /* Collapse every preferred slot across every request onto its date. */
    const byDate = new Map<string, IRequestedDate>();

    for (const request of requests) {
      for (const slot of request.preferred) {
        if (slot.date === "" || !withinWindow(slot.date, from, to)) { continue; }

        const existing = byDate.get(slot.date);
        if (existing === undefined) {
          byDate.set(slot.date, {
            date: slot.date,
            requestCount: 1,
            notes: slot.availability === "" ? [] : [slot.availability]
          });
        } else {
          existing.requestCount += 1;
          if (slot.availability !== "") { existing.notes.push(slot.availability); }
        }
      }
    }

    return {
      from,
      to,
      totalRequests: requests.length,
      requestedDates: [...byDate.values()].sort((a, b) =>
        a.date.localeCompare(b.date))
    };
  }

  /*
   * Submits a booking down the identical path the website uses.
   *
   * The caller key is fixed: an MCP server runs locally for one operator, so
   * there is no per-IP dimension to spread across. The limit is the endpoint's
   * own, which makes a runaway agent loop cost five emails rather than a
   * drained Gmail quota.
   */
  public async requestBooking(
    body: Booking.IBookingRequestBody,
    now: number = Date.now()
  ): Promise<IBookingToolResult> {

    if (Booking.isHoneypotTripped(body)) {
      /* Same silent accept the endpoint gives, for the same reason: nothing
         to tune against. Nothing is sent. */
      return { ok: true, message: "Request accepted." };
    }

    const limit = this.limiter.check("mcp", now);
    if (!limit.allowed) {
      return {
        ok: false,
        message: "Too many booking requests. Try again in " +
          `${limit.retryAfterSeconds} seconds.`
      };
    }

    const validation = Booking.validateBooking(body);
    if (validation.booking === undefined) {
      return {
        ok: false,
        message: "Some of the details need fixing.",
        errors: validation.errors
      };
    }

    const worker = new Booking.Worker(
      this.serverInfo, this.options.mailer, this.sheet());
    const row = await worker.submit(validation.booking);

    return {
      ok: true,
      message: `Booking request sent for ${row.name}. A confirmation went to ` +
        `${validation.booking.email} and the request is on its way to the sheet.`,
      row
    };
  }

}
