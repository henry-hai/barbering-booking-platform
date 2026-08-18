/*
 * The Express server. Sets up middleware and defines all REST endpoints.
 * Each endpoint instantiates the appropriate Worker and delegates the real
 * work to it.
 *
 * Start the server through boot.ts, not this file: node dist/boot.js. That
 * puts the credential files in place before the ServerInfo import below reads
 * them.
 *
 * TWO ZONES
 * ---------
 * Public: POST /booking, and the health check the host polls. The marketing
 * site posts to /booking from another origin, so it stays open and CORS-wide.
 *
 * Private: everything else, behind HTTP basic auth from Auth.ts. That covers
 * the dashboard bundle, GET /appointments and the mail and contacts routes,
 * all of which expose client details.
 */

import path from "path";                                              // Node built-in: constructs file paths
import express, { Express, NextFunction, Request, Response } from "express"; // Express app and its TypeScript types
import { serverInfo } from "./ServerInfo";                            // parsed Gmail credentials
import { createDashboardAuth } from "./Auth";                         // basic-auth guard for the dashboard
import * as IMAP from "./IMAP";                                       // IMAP Worker + interfaces
import * as SMTP from "./SMTP";                                       // SMTP Worker
import * as Contacts from "./contacts";                               // Contacts Worker
import { IContact } from "./contacts";                                // IContact type used in endpoint handlers
import * as Appointments from "./Appointments";                       // Appointments Worker (Google Sheets)
import * as Booking from "./Booking";                                 // Booking handler (validation, rate limits, the two emails)

const app: Express = express();                                       // creates the Express application instance

/* Trust one layer of reverse proxy so req.ip is the caller's address rather
   than the proxy's. The booking rate limiter keys off it, and on a managed
   host every request arrives through the platform's proxy. */
app.set("trust proxy", 1);

/* Cap the request body. The booking endpoint's own field limits add up to a
   few KB; anything near this is not a real booking. */
app.use(express.json({ limit: "64kb" }));                             // parses incoming JSON request bodies into JS objects

/* CORS middleware: runs on every request before any endpoint handler.
   Sets headers that tell the browser to allow cross-origin requests. This is
   registered ahead of everything so the headers are present on static
   responses and on the preflight the booking form triggers. */
app.use(function(inRequest: Request, inResponse: Response, inNext: NextFunction) {
  inResponse.header("Access-Control-Allow-Origin", "*");             // allow requests from any origin
  inResponse.header("Access-Control-Allow-Methods",                  // allow these HTTP methods
    "GET,POST,DELETE,OPTIONS"
  );
  inResponse.header("Access-Control-Allow-Headers",                  // allow these request headers
    "Origin,X-Requested-With,Content-Type,Accept"
  );

  /* Answer preflights here and go no further.

     A browser sends OPTIONS before any cross-origin POST carrying JSON, and it
     requires a 2xx back or it blocks the real request. Without this the
     preflight for POST /booking falls past the route below, which only matches
     POST, reaches the auth guard, and comes back 401. The booking form on the
     marketing site then fails for every visitor while curl, which sends no
     preflight, appears to work fine. */
  if (inRequest.method === "OPTIONS") {
    inResponse.sendStatus(204);
    return;
  }

  inNext();                                                           // passes control to the next middleware or endpoint
});

/* GET /healthz
   Unauthenticated so the host's health check can reach it. Reports nothing
   beyond liveness. */
app.get("/healthz", (inRequest: Request, inResponse: Response) => {
  inResponse.json({ ok: true });
});

/* POST /booking
   Public endpoint behind the appointment form on the marketing site. Validates
   every field, rate limits by IP, then sends the owner notification (which the
   server appends to the Google Sheet) and a confirmation to
   the client. The handler is built in Booking.ts so the end-to-end tests can
   mount the same one with a recording mailer.

   Registered ahead of the auth guard on purpose. It is called cross-origin by
   a browser that has no credentials to offer, so guarding it would break the
   live booking path. Its own honeypot and rate limits are what protect it. */
app.post("/booking", Booking.createBookingHandler(serverInfo));

/*
 * Everything below this line is private.
 *
 * The guard answers 401 unless the request carries the basic-auth credentials
 * from DASHBOARD_USER and DASHBOARD_PASSWORD, and 503 if the host never set
 * them. It is registered before the static middleware so the dashboard bundle
 * is covered too, not just the JSON endpoints it calls.
 */
app.use(createDashboardAuth());

app.use("/",
  express.static(path.join(__dirname, "../../client/dist"))
);

/* GET /mailboxes
   Returns a JSON array of all mailbox names and paths in the account. */
app.get("/mailboxes", async (inRequest: Request, inResponse: Response) => {
  try {
    const imapWorker: IMAP.Worker = new IMAP.Worker(serverInfo);     // instantiate IMAP Worker with Gmail credentials
    const mailboxes: IMAP.IMailbox[] = await imapWorker.listMailboxes(); // fetch flat list of mailboxes
    inResponse.json(mailboxes);                                       // send result as JSON
  } catch (inError) {
    inResponse.send("error");                                         // send plain text error if anything fails
  }
});

/* GET /mailboxes/:mailbox
   Returns a JSON array of message headers for all messages in the named mailbox. */
app.get("/mailboxes/:mailbox", async (inRequest: Request, inResponse: Response) => {
  try {
    const imapWorker: IMAP.Worker = new IMAP.Worker(serverInfo);
    const messages: IMAP.IMessage[] = await imapWorker.listMessages({
      mailbox: inRequest.params.mailbox as string                      // :mailbox from the URL becomes a string parameter; cast needed for Express 5
    });
    inResponse.json(messages);
  } catch (inError) {
    inResponse.send("error");
  }
});

/* GET /messages/:mailbox/:id
   Returns the plain text body of a specific message. */
app.get("/messages/:mailbox/:id", async (inRequest: Request, inResponse: Response) => {
  try {
    const imapWorker: IMAP.Worker = new IMAP.Worker(serverInfo);
    const messageBody: string = await imapWorker.getMessageBody({
      mailbox: inRequest.params.mailbox as string,
      id: parseInt(inRequest.params.id as string, 10)                // parseInt converts the URL string param to a whole number
    });
    inResponse.send(messageBody);                                     // send as plain text, not JSON
  } catch (inError) {
    inResponse.send("error");
  }
});

/* DELETE /messages/:mailbox/:id
   Deletes a specific message from the named mailbox. */
app.delete("/messages/:mailbox/:id", async (inRequest: Request, inResponse: Response) => {
  try {
    const imapWorker: IMAP.Worker = new IMAP.Worker(serverInfo);
    await imapWorker.deleteMessage({
      mailbox: inRequest.params.mailbox as string,
      id: parseInt(inRequest.params.id as string, 10)                // convert string param to number for IMAP Worker
    });
    inResponse.send("ok");
  } catch (inError) {
    inResponse.send("error");
  }
});

/* POST /messages
   Sends an email. Request body must contain to, from, subject, text.
   express.json() middleware already parsed the body into inRequest.body. */
app.post("/messages", async (inRequest: Request, inResponse: Response) => {
  try {
    const smtpWorker: SMTP.Worker = new SMTP.Worker(serverInfo);     // instantiate SMTP Worker with Gmail credentials
    await smtpWorker.sendMessage(inRequest.body);                     // pass the parsed request body directly to nodemailer
    inResponse.send("ok");
  } catch (inError) {
    inResponse.send("error");
  }
});

/* GET /appointments
   Returns a JSON array of booking requests from the Google Sheet that the
   booking endpoint appends to. Returns [] if sheets is unconfigured. */
app.get("/appointments", async (inRequest: Request, inResponse: Response) => {
  try {
    const appointmentsWorker: Appointments.Worker =
      new Appointments.Worker(serverInfo);
    const appointments: Appointments.IBookingRequest[] =
      await appointmentsWorker.listAppointments();
    inResponse.json(appointments);
  } catch (inError) {
    console.error("GET /appointments error:", inError);
    inResponse.status(500).json([]);
  }
});

/* GET /contacts
   Returns a JSON array of all saved contacts. */
app.get("/contacts", async (inRequest: Request, inResponse: Response) => {
  try {
    const contactsWorker: Contacts.Worker = new Contacts.Worker();   // no serverInfo needed; contacts are stored locally
    const contacts: IContact[] = await contactsWorker.listContacts();
    inResponse.json(contacts);
  } catch (inError) {
    inResponse.send("error");
  }
});

/* POST /contacts
   Adds a new contact. Returns the saved contact including its auto-generated _id. */
app.post("/contacts", async (inRequest: Request, inResponse: Response) => {
  try {
    const contactsWorker: Contacts.Worker = new Contacts.Worker();
    const contact: IContact = await contactsWorker.addContact(inRequest.body); // body contains name and email
    inResponse.json(contact);                                         // return saved contact with _id so client can display it
  } catch (inError) {
    console.error("POST /contacts error:", inError);
    inResponse.send("error");
  }
});

/* DELETE /contacts/:id
   Deletes a contact by its NeDB-generated _id. */
app.delete("/contacts/:id", async (inRequest: Request, inResponse: Response) => {
  try {
    const contactsWorker: Contacts.Worker = new Contacts.Worker();
    await contactsWorker.deleteContact(inRequest.params.id as string); // :id from the URL is the NeDB _id string
    inResponse.send("ok");
  } catch (inError) {
    inResponse.send("error");
  }
});

/* Managed hosts assign the port and pass it in; 8080 is the local default the
   client config and the README both already point at. */
const port: number = Number(process.env.PORT ?? 8080);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
