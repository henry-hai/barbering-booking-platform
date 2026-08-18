/*
 * The Resend transport and the choice between it and SMTP.
 *
 * Offline. fetch is stubbed, so no request leaves the machine and no API key
 * is needed. What matters here is that swapping the transport changes nothing
 * a booking depends on: the subject prefix the mailbox is filed under,
 * the sentinel-wrapped A..L block, and the reply-to that lets the owner answer
 * the client directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IServerInfo } from "../src/ServerInfo";
import { Worker as ResendWorker, readResendConfig } from "../src/ResendMailer";
import { createMailer, parseBookingBlock, Worker as BookingWorker } from "../src/Booking";
import { COLUMN_KEYS, RecordingLog, validBooking } from "./fixtures";

const OWNER = "owner@example.com";
const FROM = "Henry Hai Studio <bookings@henryhaistudio.com>";

const serverInfo: IServerInfo = {
  smtp: { host: "smtp.example.com", port: 465, auth: { user: OWNER, pass: "x" } },
  imap: { host: "imap.example.com", port: 993, auth: { user: OWNER, pass: "x" } }
};

const env = { RESEND_API_KEY: "re_test_key", MAIL_FROM: FROM };

/* Captures what would have gone over the wire. */
let sent: any[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "msg_test_1" })
    };
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("readResendConfig", () => {

  it("reads the key and sender from the environment", () => {
    expect(readResendConfig(env)).toEqual({ apiKey: "re_test_key", from: FROM });
  });

  it("returns undefined unless both are present", () => {
    expect(readResendConfig({ RESEND_API_KEY: "re_x" })).toBeUndefined();
    expect(readResendConfig({ MAIL_FROM: FROM })).toBeUndefined();
    expect(readResendConfig({})).toBeUndefined();
  });

});

describe("createMailer", () => {

  it("chooses Resend when the environment is configured", () => {
    expect(createMailer(serverInfo, env)).toBeInstanceOf(ResendWorker);
  });

  /* A development machine can reach Gmail directly and should need no
     account anywhere. */
  it("falls back to SMTP when it is not", () => {
    expect(createMailer(serverInfo, {})).not.toBeInstanceOf(ResendWorker);
  });

});

describe("the Resend transport", () => {

  it("posts to Resend with the verified sender, not the Gmail account", async () => {
    const mailer = new ResendWorker({ apiKey: "re_test_key", from: FROM });
    await mailer.sendMessage({
      from: OWNER, to: "client@example.com", subject: "Hello", text: "Body"
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe(FROM);
    expect(sent[0].to).toEqual(["client@example.com"]);
  });

  it("preserves reply-to so the owner can answer the client", async () => {
    const mailer = new ResendWorker({ apiKey: "re_test_key", from: FROM });
    await mailer.sendMessage({
      to: OWNER, subject: "x", text: "y", replyTo: "client@example.com"
    });

    expect(sent[0].reply_to).toEqual(["client@example.com"]);
  });

  it("throws with the response body when Resend rejects the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => '{"message":"domain is not verified"}'
    })));

    const mailer = new ResendWorker({ apiKey: "re_test_key", from: FROM });

    await expect(mailer.sendMessage({ to: "a@b.com", subject: "x", text: "y" }))
      .rejects.toThrow(/HTTP 422.*domain is not verified/);
  });

});

/* The contract tests, repeated over the new transport. If any of these break,
   the sheet breaks. */
describe("a booking sent through Resend", () => {

  const submit = async () => {
    const worker = new BookingWorker(
      serverInfo, createMailer(serverInfo, env), new RecordingLog());
    await worker.submit(validBooking);
    return sent;
  };

  it("sends both emails", async () => {
    expect(await submit()).toHaveLength(2);
  });

  it("keeps the subject prefix the mailbox is searched by", async () => {
    const messages = await submit();
    expect(messages[0].subject).toMatch(/^Appointment Request from/);
  });

  it("still carries a parseable A..L block", async () => {
    const messages = await submit();
    const parsed = parseBookingBlock(messages[0].text);

    expect(Object.keys(parsed)).toEqual(COLUMN_KEYS);
    expect(parsed.name).toBe(validBooking.name);
  });

  it("sends the owner notification to the owner and the confirmation to the client", async () => {
    const messages = await submit();
    expect(messages[0].to).toEqual([OWNER]);
    expect(messages[1].to).toEqual([validBooking.email]);
  });

});
