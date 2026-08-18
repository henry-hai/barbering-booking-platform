/*
 * Booking request handling: validation, the Sheet payload, and the two emails
 * sent per booking.
 *
 * This replaces the EmailJS call that used to run in the browser on the static
 * site. EmailJS shipped a public key to every visitor and capped out at 200
 * emails a month; this path goes through the same Gmail SMTP credentials the
 * mail client already uses, and validates every field on arrival.
 *
 * THE SHEET CONTRACT
 * ------------------
 * The twelve keys of IBookingPayload map one-to-one, in declaration order, onto
 * columns A..L of the booking sheet. Appointments.buildSheetRow() turns them
 * into the row and Appointments.listAppointments() reads them back by index, so
 * a key cannot be reordered, renamed or removed without rewriting every row the
 * sheet already holds.
 *
 * A new key may be APPENDED, which leaves every existing column untouched and
 * shows up as an empty cell on older rows. That is how `email` reached column
 * L: it was collected from the start for the client confirmation but lived only
 * in the human-readable parts of the notification, which left the dashboard
 * unable to show the one field a client is actually reached by.
 *
 * The owner notification's plain-text part still ends with the same payload as
 * JSON between two sentinels. Nothing parses it automatically any more. It is
 * kept because it is the only machine-readable copy of a request outside the
 * sheet, so if an append ever fails the row can be rebuilt from the mailbox
 * instead of retyped.
 */

import { Request, RequestHandler, Response } from "express";
import { SendMailOptions } from "nodemailer";
import { IServerInfo } from "./ServerInfo";
import * as SMTP from "./SMTP";
import { RateLimiter } from "./RateLimit";
import { DuplicateGuard } from "./Duplicates";
import * as Appointments from "./Appointments";
import * as ResendMailer from "./ResendMailer";
import { readResendConfig } from "./ResendMailer";
import {
  renderClientConfirmation,
  renderOwnerNotification
} from "./BookingEmails";

/* Fixed sentinels bounding the JSON block in the owner notification, so the
   payload can be found again in a mailbox full of prose. */
export const JSON_START = "---BOOKING_JSON_START---";
export const JSON_END = "---BOOKING_JSON_END---";

/* Placeholder written for any empty field. Appointments.ts treats it as "". */
export const NA = "N/A";

/* What the browser posts to POST /booking. */
export interface IBookingRequestBody {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  date1?: unknown;
  availability1?: unknown;
  date2?: unknown;
  availability2?: unknown;
  date3?: unknown;
  availability3?: unknown;
  description?: unknown;
  policiesAccepted?: unknown;
  /* Honeypot. Hidden from real users, so any value means a bot filled it. */
  website?: unknown;
}

/* The twelve sheet columns, in column order. See THE SHEET CONTRACT above. */
export interface IBookingPayload {
  name: string;        // A
  date: string;        // B  submitted date, America/Los_Angeles
  time: string;        // C  submitted time, America/Los_Angeles
  phone: string;       // D
  date1: string;       // E
  avail1: string;      // F
  date2: string;       // G
  avail2: string;      // H
  date3: string;       // I
  avail3: string;      // J
  description: string; // K
  /* L. Added last, deliberately: appending leaves A..K byte-for-byte
     unchanged, so a sheet, a workflow or a reader that has not been updated
     yet keeps working and simply sees an empty column. Putting it anywhere
     else would have shifted every column after it. */
  email: string;       // L
}

/*
 * A booking that passed validation, before the timestamp is applied.
 *
 * `email` is new -- the old EmailJS form never collected one, which is why
 * there was no client confirmation. It is deliberately NOT part of
 * IBookingPayload: adding a twelfth key would break the A..K mapping. It
 * appears in the owner notification's human-readable parts only.
 */
export interface IValidatedBooking {
  name: string;
  email: string;
  phone: string;
  date1: string;
  availability1: string;
  date2: string;
  availability2: string;
  date3: string;
  availability3: string;
  description: string;
}

export interface IValidationResult {
  /* Field name -> message. Empty when the booking is valid. */
  errors: Record<string, string>;
  booking?: IValidatedBooking;
}

/* Field length caps, mirrored by the client-side checks in web/lib/booking.ts. */
const LIMITS = {
  name: 100,
  email: 254,
  phone: 32,
  availability: 500,
  description: 2000
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* Deliberately permissive: one @, something either side, a dot in the domain,
   no whitespace. Anything stricter rejects addresses that are actually valid. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Coerces anything to a trimmed string. Non-strings become "", which then
   fails the required-field checks rather than reaching the sheet. */
const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const countDigits = (value: string): number => (value.match(/\d/g) ?? []).length;

/* A date input is valid if it parses to the same calendar day it claims to be,
   which rejects "2026-02-31" and friends that Date would otherwise roll over. */
const isRealDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) { return false; }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
};

/* Validates the posted body. Everything the browser sends is re-checked here;
   the client-side checks only exist to give faster feedback. */
export function validateBooking(body: IBookingRequestBody): IValidationResult {
  const errors: Record<string, string> = {};

  const name = str(body.name);
  const email = str(body.email);
  const phone = str(body.phone);
  const description = str(body.description);
  const dates = [str(body.date1), str(body.date2), str(body.date3)];
  const availabilities = [
    str(body.availability1), str(body.availability2), str(body.availability3)
  ];

  if (!name) {
    errors.name = "A name is required.";
  } else if (name.length > LIMITS.name) {
    errors.name = `Name must be ${LIMITS.name} characters or fewer.`;
  }

  if (!email) {
    errors.email = "An email address is required.";
  } else if (email.length > LIMITS.email || !EMAIL.test(email)) {
    errors.email = "A valid email address is required.";
  }

  if (!phone) {
    errors.phone = "A phone number is required.";
  } else if (countDigits(phone) < 7) {
    errors.phone = "A phone number needs at least 7 digits.";
  } else if (phone.length > LIMITS.phone) {
    errors.phone = `Phone number must be ${LIMITS.phone} characters or fewer.`;
  }

  if (!dates[0]) {
    errors.date1 = "A first preferred date is required.";
  } else if (!isRealDate(dates[0])) {
    errors.date1 = "Preferred date 1 must be a valid YYYY-MM-DD date.";
  }

  if (!availabilities[0]) {
    errors.availability1 = "Availability for the first date is required.";
  }

  /* Dates 2 and 3 are optional but must be complete pairs: a lone availability
     note or a lone date would land half-filled in the sheet. */
  for (const index of [1, 2]) {
    const label = index + 1;
    const date = dates[index] as string;
    const availability = availabilities[index] as string;

    if (date && !isRealDate(date)) {
      errors[`date${label}`] = `Preferred date ${label} must be a valid YYYY-MM-DD date.`;
    }
    if (availability && !date) {
      errors[`date${label}`] = `Preferred date ${label} is required alongside its availability.`;
    }
    if (date && !availability) {
      errors[`availability${label}`] = `Availability for date ${label} is required.`;
    }
  }

  availabilities.forEach((availability, index) => {
    if (availability.length > LIMITS.availability) {
      errors[`availability${index + 1}`] =
        `Availability must be ${LIMITS.availability} characters or fewer.`;
    }
  });

  if (!description) {
    errors.description = "A description of the haircut is required.";
  } else if (description.length > LIMITS.description) {
    errors.description = `Description must be ${LIMITS.description} characters or fewer.`;
  }

  if (body.policiesAccepted !== true) {
    errors.policiesAccepted = "The booking policies must be accepted.";
  }

  if (Object.keys(errors).length > 0) { return { errors }; }

  return {
    errors,
    booking: {
      name,
      email,
      phone,
      date1: dates[0] as string,
      availability1: availabilities[0] as string,
      date2: dates[1] as string,
      availability2: availabilities[1] as string,
      date3: dates[2] as string,
      availability3: availabilities[2] as string,
      description
    }
  };
}

/* True when the honeypot field was filled, which only a bot does. */
export const isHoneypotTripped = (body: IBookingRequestBody): boolean =>
  str(body.website) !== "";

/* Empty becomes the sheet's "N/A" placeholder. */
const orNA = (value: string): string => (value === "" ? NA : value);

/*
 * Formats the submission time for sheet columns B and C.
 *
 * Pacific rather than the server's clock, because a booking that arrives at
 * 11pm in Milpitas should not be logged as the next day. The locale and options
 * are fixed so every row in the sheet, going back to 2024, reads the same.
 */
export function formatSubmittedAt(when: Date): { date: string, time: string } {
  return {
    date: when.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }),
    time: when.toLocaleTimeString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

/* Builds the twelve-column payload. Key order here is column order A..L. */
export function buildBookingPayload(
  booking: IValidatedBooking,
  when: Date = new Date()
): IBookingPayload {
  const submittedAt = formatSubmittedAt(when);

  return {
    name: orNA(booking.name),
    date: submittedAt.date,
    time: submittedAt.time,
    phone: orNA(booking.phone),
    date1: orNA(booking.date1),
    avail1: orNA(booking.availability1),
    date2: orNA(booking.date2),
    avail2: orNA(booking.availability2),
    date3: orNA(booking.date3),
    avail3: orNA(booking.availability3),
    description: orNA(booking.description),
    email: orNA(booking.email)
  };
}

/*
 * Wraps the payload in the sentinels, for the copy in the owner email.
 *
 * Pretty-printed rather than minified: it keeps every line short, so no mail
 * transport along the way has a reason to fold one, and it stays readable if
 * anyone opens the raw email. JSON.parse is indifferent to the whitespace.
 */
export function serializeBookingBlock(payload: IBookingPayload): string {
  return `${JSON_START}\n${JSON.stringify(payload, null, 2)}\n${JSON_END}`;
}

/* Reads a payload back out of an email body. Nothing calls this on the request
   path: it exists so the round trip is testable, and so a request can be
   recovered from the mailbox if it never reached the sheet. */
export function parseBookingBlock(body: string): IBookingPayload {
  const start = body.indexOf(JSON_START);
  if (start === -1) {
    throw new Error(`Missing ${JSON_START} sentinel`);
  }
  /* indexOf rather than split: splitting on the end sentinel returns the whole
     remainder when it is absent, so a truncated email would parse whatever
     happened to follow instead of failing. */
  const end = body.indexOf(JSON_END, start);
  if (end === -1) {
    throw new Error(`Missing ${JSON_END} sentinel`);
  }
  return JSON.parse(body.slice(start + JSON_START.length, end).trim());
}

/* Minimal mailer surface, so tests can record messages instead of sending. */
/*
 * The booking log, narrowed to the one call this module makes.
 *
 * Appointments.Worker satisfies it. Naming the seam here rather than importing
 * the class means the tests can hand in a recorder, and Booking.ts never has to
 * know that the log happens to be a Google Sheet.
 */
export interface IAppointmentLog {
  appendAppointment(payload: IBookingPayload): Promise<void>;
}

export interface IMailer {
  sendMessage(options: SendMailOptions): Promise<string>;
}

/*
 * Picks the transport for a given environment.
 *
 * Resend when RESEND_API_KEY and MAIL_FROM are both set, SMTP otherwise.
 * That split is not a preference, it is a deployment constraint: Render's free
 * tier blocks the SMTP ports, so the deployed API has to send over HTTPS,
 * while a development machine can talk to Gmail directly and needs no account
 * anywhere. Both satisfy IMailer, so everything downstream is identical.
 *
 * Deliberately not memoised. A booking is infrequent enough that building a
 * transport per request costs nothing, and it keeps the choice readable.
 */
export function createMailer(
  inServerInfo: IServerInfo,
  env: NodeJS.ProcessEnv = process.env
): IMailer {
  const resend = readResendConfig(env);
  return resend === undefined
    ? new SMTP.Worker(inServerInfo)
    : new ResendMailer.Worker(resend);
}

export class Worker {

  private mailer: IMailer;
  private ownerAddress: string;
  private log: IAppointmentLog;

  /* Owner notifications go to the same Gmail account that sends them, so the
     whole history of requests stays searchable in one mailbox. The sender may
     be a different address entirely when going out through Resend. */
  constructor(
    inServerInfo: IServerInfo,
    inMailer?: IMailer,
    inLog?: IAppointmentLog
  ) {
    this.mailer = inMailer ?? createMailer(inServerInfo);
    this.ownerAddress = inServerInfo.smtp.auth.user;
    this.log = inLog ?? new Appointments.Worker(inServerInfo);
  }

  /*
   * Records one booking and sends the two emails for it.
   *
   * Three independent deliveries, and no one of them is allowed to take down
   * the others. The sheet goes first because it is what Henry works from, and
   * it no longer depends on an email arriving anywhere.
   *
   * Only a booking that left no trace at all throws. That distinction is the
   * whole point: a request that reached the sheet but failed to send the
   * confirmation has been recorded, and answering the client with an error
   * would have them submit again and put a second identical row in the sheet.
   * A booking is lost only if both the sheet and the owner notification failed,
   * and then the client should retry, because nothing anywhere knows about it.
   */
  public async submit(
    booking: IValidatedBooking,
    when: Date = new Date()
  ): Promise<IBookingPayload> {
    const payload = buildBookingPayload(booking, when);

    const attempt = async (what: string, action: () => Promise<void>): Promise<boolean> => {
      try {
        await action();
        return true;
      } catch (inError) {
        console.error(`Booking ${what} failed:`, inError);
        return false;
      }
    };

    const logged = await attempt("sheet append", async () => {
      await this.log.appendAppointment(payload);
    });

    /* The owner notification carries the whole request, JSON block included, so
       while it is not the log it is enough to rebuild the row by hand. */
    const notification = renderOwnerNotification(payload, booking.email);
    const notified = await attempt("owner notification", async () => {
      await this.mailer.sendMessage({
        from: this.ownerAddress,
        to: this.ownerAddress,
        replyTo: booking.email,
        subject: notification.subject,
        text: notification.text,
        html: notification.html
      });
    });

    const confirmation = renderClientConfirmation(payload);
    await attempt("client confirmation", async () => {
      await this.mailer.sendMessage({
        from: this.ownerAddress,
        to: booking.email,
        subject: confirmation.subject,
        text: confirmation.text,
        html: confirmation.html
      });
    });

    if (!logged && !notified) {
      throw new Error("Booking reached neither the sheet nor the owner mailbox.");
    }

    return payload;
  }

}

/* Tuning for the endpoint's rate limits, so tests can raise them. */
export interface IBookingHandlerOptions {
  /* Requests allowed per IP per window. */
  perClientLimit?: number;
  /* Requests allowed across all callers per window, as a flood backstop. */
  globalLimit?: number;
  windowMs?: number;
  /* How long an identical resubmission is treated as the same booking. */
  duplicateWindowMs?: number;
  /* Supplied when the caller needs to reset it, as the e2e harness does
     between tests. Otherwise the handler owns one for its own lifetime. */
  duplicates?: DuplicateGuard;
  /* Injected in tests to record messages instead of sending them. */
  mailer?: IMailer;
  /* Injected in tests to record sheet rows instead of writing them. */
  log?: IAppointmentLog;
}

/*
 * Builds the POST /booking handler.
 *
 * A factory rather than a bare handler so the rate limiter state and the mailer
 * are per-instance: tests get their own counters and a recording mailer without
 * any test-only branch running in production.
 */
export function createBookingHandler(
  inServerInfo: IServerInfo,
  options: IBookingHandlerOptions = {}
): RequestHandler {

  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  /* Five per IP per ten minutes leaves room for a client fixing a typo and
     resubmitting; the global cap stops a distributed flood draining the Gmail
     send quota. */
  const perClient = new RateLimiter(options.perClientLimit ?? 5, windowMs);
  const overall = new RateLimiter(options.globalLimit ?? 60, windowMs);
  /* Separate from the rate limiter, which counts requests from an address. This
     matches on the booking itself, so it catches a double-tap and nothing else. */
  const duplicates = options.duplicates ??
    new DuplicateGuard(options.duplicateWindowMs ?? 10 * 60 * 1000);

  return async (inRequest: Request, inResponse: Response): Promise<void> => {
    const body: IBookingRequestBody = inRequest.body ?? {};

    /* Honeypot: the form renders a `website` field hidden from people, so
       anything in it means a bot. Answer 200 so there is nothing to tune
       against, and send nothing. */
    if (isHoneypotTripped(body)) {
      inResponse.json({ ok: true });
      return;
    }

    const clientResult = perClient.check(inRequest.ip ?? "unknown");
    const overallResult = overall.check("global");

    if (!clientResult.allowed || !overallResult.allowed) {
      const retryAfter = !clientResult.allowed
        ? clientResult.retryAfterSeconds
        : overallResult.retryAfterSeconds;
      inResponse.set("Retry-After", String(retryAfter));
      inResponse.status(429).json({
        ok: false,
        message: "Too many booking requests. Please try again shortly."
      });
      return;
    }

    const validation = validateBooking(body);
    if (validation.booking === undefined) {
      inResponse.status(400).json({
        ok: false,
        message: "Some of the details need fixing.",
        errors: validation.errors
      });
      return;
    }

    /* A second identical submission is the same person tapping twice or
       reloading, so answer as though it worked. Telling them it failed would
       only get a third. Anything they changed makes a new fingerprint and goes
       through normally. */
    if (duplicates.isRepeat(validation.booking)) {
      inResponse.json({ ok: true });
      return;
    }

    try {
      const worker = new Worker(inServerInfo, options.mailer, options.log);
      await worker.submit(validation.booking);
      inResponse.json({ ok: true });
    } catch (inError) {
      /* Let the client retry: this booking never made it out. */
      duplicates.forget(validation.booking);
      console.error("POST /booking error:", inError);
      inResponse.status(502).json({
        ok: false,
        message: "Your request could not be sent. Please try again in a moment."
      });
    }
  };
}
