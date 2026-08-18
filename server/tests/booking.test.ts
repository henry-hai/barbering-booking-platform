/*
 * Booking validation, the A..L payload, and the sentinel-wrapped serializer.
 *
 * The serializer tests are the important ones: that block is a data contract
 * for recovering a request that never reached the sheet, and
 * tests/sheet-contract.test.ts covers the round trip.
 */

import { describe, expect, it } from "vitest";
import {
  JSON_END,
  JSON_START,
  NA,
  buildBookingPayload,
  formatSubmittedAt,
  isHoneypotTripped,
  parseBookingBlock,
  serializeBookingBlock,
  validateBooking
} from "../src/Booking";
import {
  COLUMN_KEYS,
  SUBMITTED_AT,
  SUBMITTED_DATE_LA,
  SUBMITTED_TIME_LA,
  singleSlotBooking,
  validBody,
  validBooking
} from "./fixtures";

describe("validateBooking", () => {

  it("accepts a complete booking and returns the trimmed fields", () => {
    const result = validateBooking({ ...validBody, name: "  Jordan Reyes  " });
    expect(result.errors).toEqual({});
    expect(result.booking?.name).toBe("Jordan Reyes");
  });

  it("accepts a booking with only the first slot", () => {
    const result = validateBooking({
      ...validBody, date2: "", availability2: "", date3: "", availability3: ""
    });
    expect(result.errors).toEqual({});
  });

  it("rejects an empty body without throwing", () => {
    const result = validateBooking({});
    expect(result.booking).toBeUndefined();
    expect(Object.keys(result.errors).sort()).toEqual([
      "availability1", "date1", "description", "email", "name",
      "phone", "policiesAccepted"
    ]);
  });

  it("rejects non-string field values rather than coercing them", () => {
    const result = validateBooking({
      ...validBody, name: { toString: () => "injected" }, phone: 4085550147
    });
    expect(result.errors).toHaveProperty("name");
    expect(result.errors).toHaveProperty("phone");
  });

  it("rejects a calendar date that does not exist", () => {
    /* Date would roll 2026-02-31 over to March rather than reject it. */
    expect(validateBooking({ ...validBody, date1: "2026-02-31" }).errors)
      .toHaveProperty("date1");
    expect(validateBooking({ ...validBody, date1: "2026-13-01" }).errors)
      .toHaveProperty("date1");
  });

  it("accepts a leap day in a leap year and rejects it otherwise", () => {
    expect(validateBooking({ ...validBody, date1: "2028-02-29" }).errors).toEqual({});
    expect(validateBooking({ ...validBody, date1: "2027-02-29" }).errors)
      .toHaveProperty("date1");
  });

  it("requires slots 2 and 3 to be complete pairs", () => {
    expect(validateBooking({ ...validBody, availability2: "Evenings", date2: "" }).errors)
      .toHaveProperty("date2");
    expect(validateBooking({ ...validBody, date3: "2026-08-09", availability3: "" }).errors)
      .toHaveProperty("availability3");
  });

  it("requires the policies flag to be boolean true, not truthy", () => {
    expect(validateBooking({ ...validBody, policiesAccepted: "yes" }).errors)
      .toHaveProperty("policiesAccepted");
    expect(validateBooking({ ...validBody, policiesAccepted: 1 }).errors)
      .toHaveProperty("policiesAccepted");
  });

  it("enforces the length caps", () => {
    expect(validateBooking({ ...validBody, name: "a".repeat(101) }).errors)
      .toHaveProperty("name");
    expect(validateBooking({ ...validBody, description: "a".repeat(2001) }).errors)
      .toHaveProperty("description");
    expect(validateBooking({ ...validBody, availability1: "a".repeat(501) }).errors)
      .toHaveProperty("availability1");
  });

  it("requires a plausible email address", () => {
    for (const email of ["", "jordan", "jordan@example", "a b@example.com"]) {
      expect(validateBooking({ ...validBody, email }).errors).toHaveProperty("email");
    }
    expect(validateBooking({ ...validBody, email: "jordan+cuts@sub.example.co.uk" }).errors)
      .toEqual({});
  });

});

describe("isHoneypotTripped", () => {

  it("is false for a normal submission", () => {
    expect(isHoneypotTripped(validBody)).toBe(false);
    expect(isHoneypotTripped({ ...validBody, website: "" })).toBe(false);
    expect(isHoneypotTripped({ ...validBody, website: "   " })).toBe(false);
  });

  it("is true when the hidden field carries anything", () => {
    expect(isHoneypotTripped({ ...validBody, website: "http://spam.example" })).toBe(true);
  });

});

describe("formatSubmittedAt", () => {

  it("formats in America/Los_Angeles regardless of the host timezone", () => {
    expect(formatSubmittedAt(SUBMITTED_AT)).toEqual({
      date: SUBMITTED_DATE_LA,
      time: SUBMITTED_TIME_LA
    });
  });

  it("keeps the two-digit hour the sheet has always had", () => {
    /* 15:05 UTC is 08:05 PDT: the leading zero must survive. */
    expect(formatSubmittedAt(new Date("2026-08-01T15:05:00Z")).time).toBe("08:05 AM");
  });

});

describe("buildBookingPayload", () => {

  it("emits exactly the twelve sheet columns in A..L order", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    expect(Object.keys(payload)).toEqual(COLUMN_KEYS);
  });

  it("maps each field to its column", () => {
    expect(buildBookingPayload(validBooking, SUBMITTED_AT)).toEqual({
      name: "Jordan Reyes",
      date: SUBMITTED_DATE_LA,
      time: SUBMITTED_TIME_LA,
      phone: "(408) 555-0147",
      date1: "2026-08-05",
      avail1: "After 4pm",
      date2: "2026-08-07",
      avail2: "Mornings only",
      date3: "2026-08-09",
      avail3: "Any time Saturday",
      description: "Mid fade, scissor top, beard line-up",
      email: "jordan@example.com"
    });
  });

  it("writes N/A for skipped slots, which Appointments.ts reads back as empty", () => {
    const payload = buildBookingPayload(singleSlotBooking, SUBMITTED_AT);
    expect(payload.date2).toBe(NA);
    expect(payload.avail2).toBe(NA);
    expect(payload.date3).toBe(NA);
    expect(payload.avail3).toBe(NA);
    /* The filled slot is untouched. */
    expect(payload.date1).toBe("2026-08-05");
  });

  it("passes preferred dates through as YYYY-MM-DD, unreformatted", () => {
    /* The sheet has always held the raw input value; reformatting here would
       silently rewrite what the dashboard displays. */
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    expect(payload.date1).toBe("2026-08-05");
    expect(payload.date2).toBe("2026-08-07");
    expect(payload.date3).toBe("2026-08-09");
  });

  /* The email used to be kept out of the payload entirely, on the reasoning
     that a twelfth key would break the A..K mapping. Appending one does not:
     A..K keep their positions and the new key lands in L, so a sheet or
     workflow that has not been updated sees an empty column rather than
     shifted data. Leaving it out had cost the dashboard the one field a
     client is actually reached by. */
  it("puts the email last, so A..K keep their columns", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const keys = Object.keys(payload);

    expect(keys[keys.length - 1]).toBe("email");
    expect(payload.email).toBe(validBooking.email);
    /* The first eleven are untouched, in order. */
    expect(keys.slice(0, 11)).toEqual([
      "name", "date", "time", "phone",
      "date1", "avail1", "date2", "avail2", "date3", "avail3",
      "description"
    ]);
  });

  it("writes N/A when no email reaches it", () => {
    const payload = buildBookingPayload(
      { ...validBooking, email: "" }, SUBMITTED_AT
    );
    expect(payload.email).toBe(NA);
  });

});

describe("serializeBookingBlock", () => {

  it("wraps the payload in the sentinels the workflow splits on", () => {
    const block = serializeBookingBlock(buildBookingPayload(validBooking, SUBMITTED_AT));
    expect(block.startsWith(JSON_START)).toBe(true);
    expect(block.trimEnd().endsWith(JSON_END)).toBe(true);
  });

  it("uses the exact sentinel strings", () => {
    /* Hard-coded rather than referencing the constants: if either string
       changes, every row already in the sheet is wrong, and this should fail. */
    expect(JSON_START).toBe("---BOOKING_JSON_START---");
    expect(JSON_END).toBe("---BOOKING_JSON_END---");
  });

  it("round-trips a payload byte for byte", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    expect(parseBookingBlock(serializeBookingBlock(payload))).toEqual(payload);
  });

  it("preserves key order through the round trip", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const parsed = parseBookingBlock(serializeBookingBlock(payload));
    expect(Object.keys(parsed)).toEqual(COLUMN_KEYS);
  });

  it("survives characters that would break a label-anchored parser", () => {
    const payload = buildBookingPayload({
      ...validBooking,
      name: 'Renée "Ren" O\'Brien-Smith',
      description: "Line-up + skin fade <no eyebrows>\nSecond line\tand a tab.\\backslash",
      availability1: "Phone #: 555, Preferred Date 1: whenever"
    }, SUBMITTED_AT);

    const parsed = parseBookingBlock(serializeBookingBlock(payload));
    expect(parsed).toEqual(payload);
    /* Text that looks like the old anchor labels is just data now. */
    expect(parsed.avail1).toBe("Phone #: 555, Preferred Date 1: whenever");
  });

  it("survives a maximum-length description", () => {
    const description = "A ".repeat(999) + "end";
    const payload = buildBookingPayload({ ...validBooking, description }, SUBMITTED_AT);
    expect(parseBookingBlock(serializeBookingBlock(payload)).description)
      .toBe(description);
  });

  it("finds the block inside a full email body", () => {
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const body = [
      "New appointment request from Jordan Reyes.",
      "",
      "Lots of human-readable text above.",
      serializeBookingBlock(payload),
      "",
      "And a signature below."
    ].join("\n");
    expect(parseBookingBlock(body)).toEqual(payload);
  });

  it("throws when the start sentinel is missing", () => {
    expect(() => parseBookingBlock("Just a normal email.")).toThrow(JSON_START);
  });

  it("throws when the end sentinel is missing rather than parsing what follows", () => {
    /* A truncated email must fail, not silently pick up trailing content. */
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const truncated =
      `${serializeBookingBlock(payload).split(JSON_END)[0]}\n\nSignature text.`;
    expect(() => parseBookingBlock(truncated)).toThrow(JSON_END);
  });

  it("ignores a second sentinel block later in the body", () => {
    /* A quoted reply could carry an older block; the first one wins. */
    const payload = buildBookingPayload(validBooking, SUBMITTED_AT);
    const older = buildBookingPayload(
      { ...validBooking, name: "Someone Else" }, SUBMITTED_AT
    );
    const body = `${serializeBookingBlock(payload)}\n\nquoted:\n${serializeBookingBlock(older)}`;
    expect(parseBookingBlock(body).name).toBe("Jordan Reyes");
  });

});
