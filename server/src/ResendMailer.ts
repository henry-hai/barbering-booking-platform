/*
 * Sends booking email over Resend's HTTPS API instead of SMTP.
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployed API runs on Render's free tier, which blocks outbound
 * connections on the SMTP ports (25, 465, 587) as an anti-spam measure. The
 * logs show a clean ETIMEDOUT on CONN to smtp.gmail.com:465 while the exact
 * same code sends fine from a development machine. No amount of nodemailer
 * configuration opens a closed port, so the send path moves to HTTPS, which
 * is not blocked.
 *
 * Nothing downstream changes. The owner notification still carries the same
 * sentinel-wrapped A..L JSON, still uses the "Appointment Request from"
 * subject prefix, and still lands in the owner's mailbox. The sheet row is
 * written before either email is attempted, so switching the transport is
 * invisible to the booking log.
 *
 * This implements the same IMailer surface the SMTP worker does, so
 * Booking.Worker cannot tell them apart and every existing test still drives
 * the same code path with a recording mailer.
 */

import { SendMailOptions } from "nodemailer";
import { IMailer } from "./Booking";

const ENDPOINT = "https://api.resend.com/emails";

export interface IResendConfig {
  apiKey: string;
  /* The verified sender, e.g. "Henry Hai Studio <bookings@henryhaistudio.com>".
     Resend rejects anything on an unverified domain. */
  from: string;
}

/* Reads the Resend settings out of the environment. Returns undefined when
   either is missing, which is what makes the SMTP path the fallback. */
export function readResendConfig(
  env: NodeJS.ProcessEnv = process.env
): IResendConfig | undefined {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.MAIL_FROM ?? "").trim();

  if (apiKey === "" || from === "") { return undefined; }

  return { apiKey, from };
}

/* Nodemailer's `to` is a string or an array; Resend wants an array. */
const asList = (value: SendMailOptions["to"]): string[] => {
  if (typeof value === "string") { return [value]; }
  if (Array.isArray(value)) { return value.map((entry) => String(entry)); }
  return value === undefined ? [] : [String(value)];
};

export class Worker implements IMailer {

  private config: IResendConfig;

  constructor(inConfig: IResendConfig) {
    this.config = inConfig;
  }

  /*
   * Sends one message and resolves with Resend's message id.
   *
   * The `from` on the incoming options is ignored: it is the Gmail account,
   * which Resend will not send as. The verified sender from MAIL_FROM is used
   * instead, and replyTo is preserved so answering the owner notification
   * still reaches the client.
   */
  public async sendMessage(options: SendMailOptions): Promise<string> {
    const body: Record<string, unknown> = {
      from: this.config.from,
      to: asList(options.to),
      subject: String(options.subject ?? "")
    };

    if (options.text !== undefined) { body.text = String(options.text); }
    if (options.html !== undefined) { body.html = String(options.html); }
    if (options.replyTo !== undefined) {
      body.reply_to = asList(options.replyTo as SendMailOptions["to"]);
    }

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      /* Resend returns a JSON error body. Surface it, because "email failed"
         with no detail is the thing that cost hours on the SMTP path. */
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Resend rejected the message (HTTP ${response.status}): ${detail}`
      );
    }

    const sent = await response.json() as { id?: string };
    return sent.id ?? "";
  }

}
