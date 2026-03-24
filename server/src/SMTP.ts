/*
 * Handles outbound email via Gmail's SMTP server using nodemailer.
 * Exports a Worker class with a sendMessage() method.
 */

/* nodemailer imports:
   - Mail: type for a nodemailer transport object.
   - SendMailOptions: describes a message (to, from, subject, text).
   - SentMessageInfo: response object returned after sending. */
import Mail from "nodemailer/lib/mailer";
import * as nodemailer from "nodemailer";
import { SendMailOptions, SentMessageInfo } from "nodemailer";

/* IServerInfo provides the SMTP connection credentials from ServerInfo.ts. */
import { IServerInfo } from "./ServerInfo";

/* Worker class instantiated by main.ts to send email. */
export class Worker {

  /* Static field holds the server config for the lifetime of the class.
     Static belongs to class itself rather than any one instance. */
  private static serverInfo: IServerInfo;

  /* Receives server credentials and stores them in the static field. */
  constructor(inServerInfo: IServerInfo) {
    Worker.serverInfo = inServerInfo;
  }

  /* Sends an email using the SMTP credentials from serverInfo.
     inOptions must contain to, from, subject, and text fields.
     Returns Promise<string> so main.ts can call it with async/await.
     nodemailer's API is callback-based, so it is wrapped in a Promise
     to make it compatible with async/await. */
  public sendMessage(inOptions: SendMailOptions):
    Promise<string> {
    return new Promise((inResolve, inReject) => {

      /* Creates a transport - an active connection to the SMTP server.
         Passes the smtp block from serverInfo (host, port, auth). */
      const transport: Mail = nodemailer.createTransport(Worker.serverInfo.smtp);

      // Sends the email. Callback receives either an Error or success info.
      transport.sendMail(inOptions,
        (inError: Error | null, inInfo: SentMessageInfo) => {
          if (inError) {
            inReject(inError);
          } else {
            inResolve("");
          }
        }
      );
    });
  }

}
