/*
 * Covers both MCP tools, offline.
 *
 * No secrets, no network, no Gmail and no Google. The mailer is a recorder,
 * the sheet is a stub, and the serverInfo is fabricated. The final block
 * drives the real MCP server through an in-memory transport with a real MCP
 * client, so the tool registrations and their schemas are exercised as a
 * client would see them rather than only being called directly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { SendMailOptions } from "nodemailer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { IServerInfo } from "../src/ServerInfo";
import { IBookingRequest } from "../src/Appointments";
import { IBookingPayload, JSON_START, JSON_END, parseBookingBlock } from "../src/Booking";
import { BookingTools, IAppointmentsSheet } from "../src/mcp/BookingTools";
import { createMcpServer } from "../src/mcp/server";
import { COLUMN_KEYS, validBody } from "./fixtures";

const OWNER = "owner@example.com";

/* Fabricated. Nothing here reaches a real service. */
const serverInfo: IServerInfo = {
  smtp: { host: "smtp.example.com", port: 465, auth: { user: OWNER, pass: "x" } },
  imap: { host: "imap.example.com", port: 993, auth: { user: OWNER, pass: "x" } },
  sheets: { spreadsheetId: "sheet-id", range: "Sheet1!A:K" }
};

/* Records instead of sending. Same shape as the one the booking tests use. */
class RecordingMailer {
  public sent: SendMailOptions[] = [];
  public async sendMessage(options: SendMailOptions): Promise<string> {
    this.sent.push(options);
    return "recorded";
  }
}

/* Stands in for Appointments.Worker, so the Sheets client is never built and
   nothing in this file can reach Google. Appended rows are kept so a test can
   assert on what a booking wrote. */
class StubSheet implements IAppointmentsSheet {
  public appended: IBookingPayload[] = [];
  constructor(private rows: IBookingRequest[]) {}
  public async listAppointments(): Promise<IBookingRequest[]> {
    return this.rows;
  }
  public async appendAppointment(payload: IBookingPayload): Promise<void> {
    this.appended.push(payload);
  }
}

const request = (
  name: string,
  preferred: { date: string, availability: string }[]
): IBookingRequest => ({
  name,
  submittedDate: "8/1/2026",
  submittedTime: "12:30 PM",
  phone: "408-555-0147",
  preferred,
  notes: "Mid fade"
});

const SHEET = [
  request("Jordan", [
    { date: "2026-08-05", availability: "After 4pm" },
    { date: "2026-08-07", availability: "Mornings" }
  ]),
  request("Alex", [
    { date: "2026-08-05", availability: "Any time" },
    { date: "2026-08-20", availability: "Evenings" }
  ]),
  request("Sam", [
    { date: "2026-09-01", availability: "Weekend" }
  ])
];

describe("check_availability", () => {

  let tools: BookingTools;

  beforeEach(() => {
    tools = new BookingTools(serverInfo, { appointments: new StubSheet(SHEET) });
  });

  it("collapses preferred slots onto their dates, newest window first", async () => {
    const result = await tools.checkAvailability();

    expect(result.totalRequests).toBe(3);
    expect(result.requestedDates.map((d) => d.date)).toEqual([
      "2026-08-05", "2026-08-07", "2026-08-20", "2026-09-01"
    ]);
  });

  it("counts every request that names the same date", async () => {
    const result = await tools.checkAvailability();
    const busiest = result.requestedDates.find((d) => d.date === "2026-08-05");

    expect(busiest?.requestCount).toBe(2);
    expect(busiest?.notes).toEqual(["After 4pm", "Any time"]);
  });

  it("applies an inclusive from and to window", async () => {
    const result = await tools.checkAvailability({
      from: "2026-08-05", to: "2026-08-20"
    });

    expect(result.requestedDates.map((d) => d.date)).toEqual([
      "2026-08-05", "2026-08-07", "2026-08-20"
    ]);
    expect(result.from).toBe("2026-08-05");
    expect(result.to).toBe("2026-08-20");
  });

  it("ignores a malformed bound rather than filtering everything out", async () => {
    const result = await tools.checkAvailability({ from: "August 5th" });

    expect(result.from).toBeNull();
    expect(result.requestedDates).toHaveLength(4);
  });

  it("returns an empty list when the sheet is empty", async () => {
    const empty = new BookingTools(serverInfo, {
      appointments: new StubSheet([])
    });
    const result = await empty.checkAvailability();

    expect(result.totalRequests).toBe(0);
    expect(result.requestedDates).toEqual([]);
  });

});

describe("request_booking", () => {

  let mailer: RecordingMailer;
  let tools: BookingTools;

  beforeEach(() => {
    mailer = new RecordingMailer();
    tools = new BookingTools(serverInfo, {
      mailer, appointments: new StubSheet(SHEET)
    });
  });

  it("sends the same two emails the website path sends", async () => {
    const result = await tools.requestBooking(validBody);

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]?.to).toBe(OWNER);
    expect(mailer.sent[1]?.to).toBe(validBody.email);
  });

  /* The load-bearing one. A booking made over MCP has to be recorded in exactly
     the shape a booking made on the site does. */
  it("emits the sentinel block a booking can be recovered from", async () => {
    await tools.requestBooking(validBody);

    const text = String(mailer.sent[0]?.text);
    expect(text).toContain(JSON_START);
    expect(text).toContain(JSON_END);

    const parsed = parseBookingBlock(text);
    expect(Object.keys(parsed)).toEqual(COLUMN_KEYS);
    expect(parsed.name).toBe(validBody.name);
    expect(parsed.date1).toBe(validBody.date1);
  });

  it("keeps the subject prefix the Gmail trigger filters on", async () => {
    await tools.requestBooking(validBody);
    expect(String(mailer.sent[0]?.subject)).toMatch(/^Appointment Request from/);
  });

  it("writes N/A into the columns an optional field left empty", async () => {
    await tools.requestBooking({
      ...validBody, date2: "", availability2: "", date3: "", availability3: ""
    });

    const parsed = parseBookingBlock(String(mailer.sent[0]?.text));
    expect(parsed.date2).toBe("N/A");
    expect(parsed.avail3).toBe("N/A");
  });

  it("rejects invalid input with the server's own field errors", async () => {
    const result = await tools.requestBooking({
      ...validBody, email: "not-an-email", phone: "123"
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toMatchObject({
      email: expect.any(String), phone: expect.any(String)
    });
    expect(mailer.sent).toHaveLength(0);
  });

  it("refuses a booking that has not accepted the policies", async () => {
    const result = await tools.requestBooking({
      ...validBody, policiesAccepted: false
    });

    expect(result.ok).toBe(false);
    expect(result.errors?.policiesAccepted).toBeDefined();
    expect(mailer.sent).toHaveLength(0);
  });

  it("swallows a honeypot hit without sending anything", async () => {
    const result = await tools.requestBooking({
      ...validBody, website: "http://spam.example"
    });

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(0);
  });

  it("rate limits a runaway caller after the fifth request", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await tools.requestBooking(validBody)).ok).toBe(true);
    }

    const blocked = await tools.requestBooking(validBody);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/Too many booking requests/);
    /* Ten emails from five bookings, and nothing from the sixth. */
    expect(mailer.sent).toHaveLength(10);
  });

  it("returns the eleven columns exactly as they were written", async () => {
    const result = await tools.requestBooking(validBody);

    expect(result.row).toBeDefined();
    expect(parseBookingBlock(String(mailer.sent[0]?.text))).toEqual(result.row);
  });

});

/* Drives the actual MCP server the way a client does, over a paired in-memory
   transport, so the registrations and schemas are covered too. */
describe("the MCP server over a client connection", () => {

  const connect = async (mailer: RecordingMailer) => {
    const server = createMcpServer(serverInfo, {
      mailer, appointments: new StubSheet(SHEET)
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    return client;
  };

  it("advertises both tools", async () => {
    const client = await connect(new RecordingMailer());
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort())
      .toEqual(["check_availability", "request_booking"]);
  });

  it("answers check_availability with the requested dates", async () => {
    const client = await connect(new RecordingMailer());
    const result: any = await client.callTool({
      name: "check_availability",
      arguments: { from: "2026-08-01", to: "2026-08-31" }
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.requestedDates.map((d: any) => d.date))
      .toEqual(["2026-08-05", "2026-08-07", "2026-08-20"]);
  });

  it("books through the tool call and sends both emails", async () => {
    const mailer = new RecordingMailer();
    const client = await connect(mailer);

    const result: any = await client.callTool({
      name: "request_booking",
      arguments: validBody
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(mailer.sent).toHaveLength(2);
    expect(parseBookingBlock(String(mailer.sent[0]?.text)).name)
      .toBe(validBody.name);
  });

  it("rejects a tool call whose arguments fail the schema", async () => {
    const client = await connect(new RecordingMailer());

    const result: any = await client.callTool({
      name: "request_booking",
      arguments: { name: "Jordan" }
    });

    expect(result.isError).toBe(true);
  });

});
