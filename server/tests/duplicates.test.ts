/*
 * The duplicate guard, and the booking endpoint's use of it.
 *
 * The case this exists for is mundane: someone taps Submit, nothing visibly
 * happens for a second, so they tap it again. Both requests are valid, both
 * pass the rate limiter, and the sheet ends up with two identical cards.
 * Thirteen of those turned up in the two years of history that were imported.
 *
 * The tests that matter most are the ones proving it does NOT fire. A client
 * fixing a typo thirty seconds later must get through, or the guard has
 * quietly started dropping real bookings and nobody would find out until
 * someone showed up for an appointment that was never recorded.
 */

import { describe, expect, it, vi } from "vitest";
import { DuplicateGuard, fingerprint } from "../src/Duplicates";
import { createBookingHandler } from "../src/Booking";
import type { IMailer } from "../src/Booking";
import type { IServerInfo } from "../src/ServerInfo";
import { RecordingLog, validBody, validBooking } from "./fixtures";

const serverInfo = {
  smtp: { host: "smtp.example", port: 465, auth: { user: "owner@example.com", pass: "x" } },
  imap: { host: "imap.example", port: 993, auth: { user: "owner@example.com", pass: "x" } },
  sheets: { spreadsheetId: "sheet-id", range: "Sheet1!A:L" }
} as IServerInfo;

const recordingMailer = (): IMailer & { sent: any[] } => {
  const sent: any[] = [];
  return { sent, async sendMessage(options: any) { sent.push(options); } };
};

const response = (): any => {
  const sent: any = { status: 200, body: undefined, headers: {} };
  return {
    sent,
    status(code: number) { sent.status = code; return this; },
    json(body: unknown) { sent.body = body; return this; },
    set(key: string, value: string) { sent.headers[key] = value; return this; }
  };
};

const post = (body: unknown): any => ({ body, ip: "203.0.113.7", headers: {} });

describe("fingerprint", () => {

  it("ignores case and surrounding whitespace", () => {
    expect(fingerprint({ ...validBooking, availability1: "  AFTER 4PM  " }))
      .toBe(fingerprint({ ...validBooking, availability1: "after 4pm" }));
  });

  it("ignores repeated whitespace inside a value", () => {
    expect(fingerprint({ ...validBooking, description: "Mid  fade,   scissor top" }))
      .toBe(fingerprint({ ...validBooking, description: "Mid fade, scissor top" }));
  });

  it("does not let a value run into the next field", () => {
    /* Without a separator "Jo" + "Ann" and "JoAnn" + "" would collide. */
    expect(fingerprint({ ...validBooking, name: "Jo", email: "ann@example.com" }))
      .not.toBe(fingerprint({ ...validBooking, name: "Joann", email: "@example.com" }));
  });

});

describe("DuplicateGuard", () => {

  it("lets the first submission through", () => {
    expect(new DuplicateGuard().isRepeat(validBooking)).toBe(false);
  });

  it("catches an identical submission moments later", () => {
    const guard = new DuplicateGuard(10 * 60 * 1000);
    expect(guard.isRepeat(validBooking, 1_000)).toBe(false);
    expect(guard.isRepeat(validBooking, 1_400)).toBe(true);
  });

  it("lets an identical submission through once the window has passed", () => {
    const guard = new DuplicateGuard(10 * 60 * 1000);
    expect(guard.isRepeat(validBooking, 0)).toBe(false);
    expect(guard.isRepeat(validBooking, 10 * 60 * 1000 + 1)).toBe(false);
  });

  it("lets a client change their times and rebook straight away", () => {
    const guard = new DuplicateGuard();
    guard.isRepeat(validBooking, 1_000);
    expect(guard.isRepeat(
      { ...validBooking, date1: "2026-08-06", availability1: "Mornings" }, 1_100
    )).toBe(false);
  });

  it("lets a client correct a mistyped phone number", () => {
    const guard = new DuplicateGuard();
    guard.isRepeat(validBooking, 1_000);
    expect(guard.isRepeat({ ...validBooking, phone: "(408) 555-0148" }, 1_100)).toBe(false);
  });

  it("lets a client add a note to an otherwise identical request", () => {
    const guard = new DuplicateGuard();
    guard.isRepeat(validBooking, 1_000);
    expect(guard.isRepeat(
      { ...validBooking, description: "Mid fade, and take the beard shorter" }, 1_100
    )).toBe(false);
  });

  it("treats two different people as different bookings", () => {
    const guard = new DuplicateGuard();
    guard.isRepeat(validBooking, 1_000);
    expect(guard.isRepeat(
      { ...validBooking, name: "Sam Okafor", email: "sam@example.com" }, 1_100
    )).toBe(false);
  });

  it("measures the window from the latest attempt, not the first", () => {
    /* Otherwise someone holding the button down gets a duplicate through the
       moment the original expires. */
    const guard = new DuplicateGuard(1_000);
    expect(guard.isRepeat(validBooking, 0)).toBe(false);
    expect(guard.isRepeat(validBooking, 900)).toBe(true);
    expect(guard.isRepeat(validBooking, 1_500)).toBe(true);
  });

  it("forgets a booking so a retry is not mistaken for a duplicate", () => {
    const guard = new DuplicateGuard();
    expect(guard.isRepeat(validBooking, 1_000)).toBe(false);
    guard.forget(validBooking);
    expect(guard.isRepeat(validBooking, 1_100)).toBe(false);
  });

});

describe("POST /booking", () => {

  const handlerWith = () => {
    const mailer = recordingMailer();
    const log = new RecordingLog();
    return { mailer, log, handler: createBookingHandler(serverInfo, { mailer, log }) };
  };

  it("writes one row and sends two emails for a single booking", async () => {
    const { handler, mailer, log } = handlerWith();
    const res = response();

    await handler(post(validBody), res, vi.fn());

    expect(res.sent.body).toEqual({ ok: true });
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]?.name).toBe(validBooking.name);
    expect(mailer.sent).toHaveLength(2);
  });

  it("writes nothing extra when the same form is submitted twice", async () => {
    const { handler, mailer, log } = handlerWith();
    const first = response();
    const second = response();

    await handler(post(validBody), first, vi.fn());
    await handler(post(validBody), second, vi.fn());

    /* The client is told it worked, because it did, the first time. Telling
       them it failed would only get a third submission. */
    expect(second.sent.status).toBe(200);
    expect(second.sent.body).toEqual({ ok: true });
    expect(log.rows).toHaveLength(1);
    expect(mailer.sent).toHaveLength(2);
  });

  it("writes a second row when the client changes something", async () => {
    const { handler, log } = handlerWith();

    await handler(post(validBody), response(), vi.fn());
    await handler(
      post({ ...validBody, availability1: "Actually, after 6pm" }), response(), vi.fn());

    expect(log.rows).toHaveLength(2);
  });

  it("still records the booking when the emails fail", async () => {
    /* The row is in the sheet, so the booking happened. Answering with an error
       would only get the client to submit it again. */
    const log = new RecordingLog();
    const broken: IMailer = { async sendMessage() { throw new Error("SMTP is down"); } };
    const handler = createBookingHandler(serverInfo, { mailer: broken, log });
    const res = response();

    await handler(post(validBody), res, vi.fn());

    expect(res.sent.status).toBe(200);
    expect(log.rows).toHaveLength(1);
  });

  it("tells the client to retry only when nothing was recorded anywhere", async () => {
    const mailer = recordingMailer();
    let healthy = false;
    const flaky: IMailer = {
      async sendMessage(options: any) {
        if (!healthy) { throw new Error("SMTP is down"); }
        await mailer.sendMessage(options);
      }
    };
    const deadLog = {
      async appendAppointment() { throw new Error("Sheets is down"); }
    };
    const handler = createBookingHandler(serverInfo, { mailer: flaky, log: deadLog });

    const failed = response();
    await handler(post(validBody), failed, vi.fn());
    expect(failed.sent.status).toBe(502);

    /* The same booking again once things recover. It must not be swallowed as a
       duplicate, because the first attempt left no trace of it anywhere. */
    healthy = true;
    const retried = response();
    await handler(post(validBody), retried, vi.fn());
    expect(retried.sent.body).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(2);
  });

  it("records nothing for a honeypot hit", async () => {
    const { handler, mailer, log } = handlerWith();
    const res = response();

    await handler(post({ ...validBody, website: "http://spam.example" }), res, vi.fn());

    expect(res.sent.body).toEqual({ ok: true });
    expect(log.rows).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it("records nothing for a booking that fails validation", async () => {
    const { handler, log } = handlerWith();
    const res = response();

    await handler(post({ ...validBody, email: "not-an-address" }), res, vi.fn());

    expect(res.sent.status).toBe(400);
    expect(log.rows).toHaveLength(0);
  });

});
