/*
 * Booking API for the end-to-end tests.
 *
 * Mounts the real POST /booking handler from src/Booking.ts -- the same
 * validation, honeypot and rate limiting production runs -- with a mailer that
 * records messages instead of sending them. Nothing here needs credentials or
 * network access, so CI can run it with no secrets.
 *
 * Extra routes, test-only, for asserting on what was "sent":
 *   GET    /__outbox  the recorded messages
 *   GET    /__rows    the rows that would have gone to the sheet
 *   DELETE /__outbox  clears both between tests
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..");
/* Anchored inside server/ so express resolves from server/node_modules however
   this file is invoked. Paths to the compiled sources stay absolute. */
const require = createRequire(path.join(serverRoot, "package.json"));

const express = require("express");
const Booking = require(path.join(serverRoot, "dist/Booking.js"));
const { DuplicateGuard } = require(path.join(serverRoot, "dist/Duplicates.js"));

const PORT = Number(process.env.PORT ?? 8181);

/* Stands in for the gitignored serverInfo.json. The address is only used as
   the From and as the owner's recipient; nothing connects to Gmail. */
const serverInfo = {
  smtp: {
    host: "smtp.invalid",
    port: 465,
    auth: { user: "owner@example.com", pass: "not-a-real-password" }
  },
  imap: {
    host: "imap.invalid",
    port: 993,
    auth: { user: "owner@example.com", pass: "not-a-real-password" }
  }
};

const outbox = [];

const recordingMailer = {
  async sendMessage(options) {
    outbox.push(options);
    return "";
  }
};

/* Stands in for the Google Sheet. Without it the handler builds a real Sheets
   client, and the suite would depend on a credential file to run. */
const rows = [];

const recordingLog = {
  async appendAppointment(payload) {
    rows.push(payload);
  }
};

/* Held here rather than inside the handler so it can be cleared between tests.
   Every test posts the same fixture, which is precisely what the guard exists
   to collapse, so without a reset each test after the first would be dropped
   as a repeat of the one before it. */
const duplicates = new DuplicateGuard();

const app = express();
app.use(express.json({ limit: "64kb" }));

app.use((request, response, next) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.header("Access-Control-Allow-Headers", "Origin,X-Requested-With,Content-Type,Accept");
  if (request.method === "OPTIONS") { response.sendStatus(204); return; }
  next();
});

app.post("/booking", Booking.createBookingHandler(serverInfo, {
  mailer: recordingMailer,
  log: recordingLog,
  duplicates,
  /* Raised so an ordinary test run does not trip the limit; the rate limiter
     itself is covered by tests/ratelimit.test.ts. */
  perClientLimit: 100,
  globalLimit: 1000
}));

app.get("/__outbox", (_request, response) => { response.json(outbox); });

/* The rows a run of the suite would have written to the sheet. */
app.get("/__rows", (_request, response) => { response.json(rows); });

app.delete("/__outbox", (_request, response) => {
  outbox.length = 0;
  rows.length = 0;
  duplicates.reset();
  response.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Booking test harness listening on ${PORT}`);
});
