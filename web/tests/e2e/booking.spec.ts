/*
 * End-to-end booking path: fill the form on the real site, submit, and assert
 * both emails were dispatched.
 *
 * SMTP is mocked at the mailer seam by the harness in
 * server/tests/e2e-harness.mjs, which mounts the production POST /booking
 * handler with a recorder in place of nodemailer. Nothing here touches Gmail,
 * Sheets, so it runs in CI with no secrets.
 */

import { expect, test, type Page } from "@playwright/test";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8181";

const OWNER = "owner@example.com";
const CLIENT = {
  name: "Jordan Reyes",
  email: "jordan@example.com",
  phone: "(408) 555-0147",
  date1: "2026-08-05",
  availability1: "After 4pm on weekdays",
  date2: "2026-08-07",
  availability2: "Mornings only",
  date3: "2026-08-09",
  availability3: "Any time Saturday",
  description: "Mid fade, scissor top, beard line-up"
};

interface ISentMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/*
 * Blocks until React has hydrated.
 *
 * The page is statically generated, so the form markup is in the HTML well
 * before the JavaScript attaches. Clicking Submit in that window does nothing
 * at all, which showed up as a first-test-only flake. Toggling a gallery tab is
 * a genuine hydration signal: aria-selected only moves through React state.
 */
async function waitForHydration(page: Page) {
  const artwork = page.getByRole("tab", { name: "Artwork" });
  await expect(artwork).toBeVisible();
  await expect(async () => {
    await artwork.click();
    await expect(artwork).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Haircuts" }).click();
}

async function readOutbox(page: Page): Promise<ISentMessage[]> {
  const response = await page.request.get(`${API_URL}/__outbox`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function readRows(page: Page): Promise<Record<string, string>[]> {
  const response = await page.request.get(`${API_URL}/__rows`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function fillBookingForm(page: Page, overrides: Partial<typeof CLIENT> = {}) {
  const values = { ...CLIENT, ...overrides };

  await page.getByLabel("Name").fill(values.name);
  await page.getByLabel("Email").fill(values.email);
  await page.getByLabel("Phone Number").fill(values.phone);

  await page.getByLabel("Preferred Date 1").fill(values.date1);
  await page.getByLabel("Availability").nth(0).fill(values.availability1);
  await page.getByLabel("Preferred Date 2 (Optional)").fill(values.date2);
  await page.getByLabel("Availability").nth(1).fill(values.availability2);
  await page.getByLabel("Preferred Date 3 (Optional)").fill(values.date3);
  await page.getByLabel("Availability").nth(2).fill(values.availability3);

  await page.getByLabel("Description of Haircut / Other Comments").fill(values.description);
  await page.getByLabel("I accept the booking policies").check();

  return values;
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${API_URL}/__outbox`);
  await page.goto("/");
  await waitForHydration(page);
});

test("a booking is recorded as a sheet row before any email goes out", async ({ page }) => {
  await fillBookingForm(page);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Request received")).toBeVisible();

  const rows = await readRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: CLIENT.name,
    phone: CLIENT.phone,
    date1: CLIENT.date1,
    avail1: CLIENT.availability1,
    description: CLIENT.description,
    email: CLIENT.email
  });
});

test("submitting the same form twice records one row", async ({ page }) => {
  await fillBookingForm(page);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Request received")).toBeVisible();

  /* Back to the form and send the identical request again, the way a client
     who did not see the confirmation would. */
  await page.goto("/");
  await waitForHydration(page);
  await fillBookingForm(page);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Request received")).toBeVisible();

  expect(await readRows(page)).toHaveLength(1);
  expect(await readOutbox(page)).toHaveLength(2);
});

test("a booking dispatches both the owner notification and the client confirmation", async ({ page }) => {
  await fillBookingForm(page);
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("Request received")).toBeVisible();
  /* Matches the name rather than the whole sentence, so rewording the
     confirmation copy does not fail a test about dispatching email. */
  await expect(page.getByText(new RegExp(`Thank you, ${CLIENT.name}`))).toBeVisible();

  const sent = await readOutbox(page);
  expect(sent).toHaveLength(2);

  const notification = sent.find((message) => message.to === OWNER);
  const confirmation = sent.find((message) => message.to === CLIENT.email);
  expect(notification, "owner notification was not dispatched").toBeDefined();
  expect(confirmation, "client confirmation was not dispatched").toBeDefined();

  /* The subject every request is filed under in the owner's mailbox. */
  expect(notification!.subject).toBe(`Appointment Request from ${CLIENT.name}`);
  expect(notification!.replyTo).toBe(CLIENT.email);

  /* The confirmation echoes the name and every slot offered. */
  expect(confirmation!.subject).toContain("Appointment request received");
  expect(confirmation!.text).toContain(CLIENT.name);
  for (const availability of [CLIENT.availability1, CLIENT.availability2, CLIENT.availability3]) {
    expect(confirmation!.text).toContain(availability);
  }
  expect(confirmation!.text).toContain("August 5, 2026");
  expect(confirmation!.text).toContain("August 7, 2026");
  expect(confirmation!.text).toContain("August 9, 2026");

  /* Both parts present on both messages. */
  for (const message of sent) {
    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(message.html).toContain("<table");
  }
});

test("the owner notification carries a parseable sentinel block mapping to columns A..L", async ({ page }) => {
  await fillBookingForm(page);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Request received")).toBeVisible();

  const sent = await readOutbox(page);
  const notification = sent.find((message) => message.to === OWNER)!;

  const start = notification.text.indexOf("---BOOKING_JSON_START---");
  const end = notification.text.indexOf("---BOOKING_JSON_END---");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const block = notification.text
    .slice(start + "---BOOKING_JSON_START---".length, end)
    .trim();
  const payload = JSON.parse(block);

  /* Key order is the sheet's column order. */
  expect(Object.keys(payload)).toEqual([
    "name", "date", "time", "phone",
    "date1", "avail1", "date2", "avail2", "date3", "avail3",
    "description", "email"
  ]);

  expect(payload.name).toBe(CLIENT.name);
  expect(payload.phone).toBe(CLIENT.phone);
  expect(payload.date1).toBe(CLIENT.date1);
  expect(payload.avail1).toBe(CLIENT.availability1);
  expect(payload.date3).toBe(CLIENT.date3);
  expect(payload.description).toBe(CLIENT.description);

  /* The email is the twelfth key and lands in column L. Appending it leaves
     A..K in place, which is why it could be added at all: an older sheet or
     workflow sees an empty column rather than shifted data. */
  expect(payload.email).toBe(CLIENT.email);

  /* The confirmation carries no machine-readable block. */
  const confirmation = sent.find((message) => message.to === CLIENT.email)!;
  expect(confirmation.text).not.toContain("BOOKING_JSON_START");
});

test("skipped optional slots reach the payload as N/A", async ({ page }) => {
  await page.getByLabel("Name").fill(CLIENT.name);
  await page.getByLabel("Email").fill(CLIENT.email);
  await page.getByLabel("Phone Number").fill(CLIENT.phone);
  await page.getByLabel("Preferred Date 1").fill(CLIENT.date1);
  await page.getByLabel("Availability").nth(0).fill(CLIENT.availability1);
  await page.getByLabel("Description of Haircut / Other Comments").fill(CLIENT.description);
  await page.getByLabel("I accept the booking policies").check();
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("Request received")).toBeVisible();

  const sent = await readOutbox(page);
  const notification = sent.find((message) => message.to === OWNER)!;
  const start = notification.text.indexOf("---BOOKING_JSON_START---");
  const end = notification.text.indexOf("---BOOKING_JSON_END---");
  const payload = JSON.parse(
    notification.text.slice(start + "---BOOKING_JSON_START---".length, end).trim()
  );

  expect(payload.date2).toBe("N/A");
  expect(payload.avail2).toBe("N/A");
  expect(payload.date3).toBe("N/A");
  expect(payload.avail3).toBe("N/A");
  expect(payload.date1).toBe(CLIENT.date1);
});

test("an invalid form sends nothing", async ({ page }) => {
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("Please enter your name.")).toBeVisible();
  expect(await readOutbox(page)).toHaveLength(0);
});

test("a bot filling the honeypot gets a success response but sends nothing", async ({ page }) => {
  /* Posted directly: the field is hidden and out of the tab order, so a real
     user cannot reach it. */
  const response = await page.request.post(`${API_URL}/booking`, {
    data: {
      name: CLIENT.name, email: CLIENT.email, phone: CLIENT.phone,
      date1: CLIENT.date1, availability1: CLIENT.availability1,
      date2: "", availability2: "", date3: "", availability3: "",
      description: CLIENT.description, policiesAccepted: true,
      website: "http://spam.example"
    }
  });

  expect(response.status()).toBe(200);
  expect(await readOutbox(page)).toHaveLength(0);
});

test("the server rejects a payload the browser would have caught", async ({ page }) => {
  const response = await page.request.post(`${API_URL}/booking`, {
    data: {
      name: "", email: "not-an-email", phone: "1",
      date1: "2026-02-31", availability1: "",
      description: "", policiesAccepted: false
    }
  });

  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(Object.keys(body.errors)).toEqual(
    expect.arrayContaining(["name", "email", "phone", "date1", "description", "policiesAccepted"])
  );
  expect(await readOutbox(page)).toHaveLength(0);
});
