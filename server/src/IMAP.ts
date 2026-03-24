/*
 * Handles inbound email via Gmail's IMAP server.
 * Exports three interfaces and a Worker class with four methods:
 * listMailboxes(), listMessages(), getMessageBody(), deleteMessage().
 */

/* emailjs-imap-client has no TypeScript bindings, so require() is
   used instead of import. ImapClient connects to the IMAP server. */
   const ImapClient = require("emailjs-imap-client");

   /* mailparser's simpleParser converts raw email data into structured fields
      (subject, from, text, etc.). ParsedMail is its TypeScript type. */
   import { ParsedMail } from "mailparser";
   import { simpleParser } from "mailparser";
   
   /* IServerInfo provides the IMAP connection credentials from ServerInfo.ts. */
   import { IServerInfo } from "./ServerInfo";
   
   /* ICallOptions is passed to listMessages(), getMessageBody(), deleteMessage().
      mailbox is always required. id is optional - only needed when targeting
      a specific message. */
   export interface ICallOptions {
     mailbox: string,
     id?: number
   }
   
   /* IMessage describes a single email entry.
      body is optional -- listMessages() omits it to save bandwidth.
      getMessageBody() returns it separately on demand. */
   export interface IMessage {
     id: string, date: string,
     from: string,
     subject: string, body?: string
   }
   
   /* IMailbox describes a mailbox/folder entry.
      name is the display label, path is the identifier used in IMAP calls. */
   export interface IMailbox { name: string, path: string }
   
   /* Disables TLS certificate validation for the IMAP connection.
      Required to connect to Gmail's IMAP server in this context. */
   process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
   
   /* Worker class instantiated by main.ts for all IMAP operations. */
   export class Worker {
   
     /* Static field holds the server config for the lifetime of the class. */
     private static serverInfo: IServerInfo;
   
     constructor(inServerInfo: IServerInfo) {
       Worker.serverInfo = inServerInfo;
     }
   
     /* Creates and connects an ImapClient instance.
        Called internally by all four Worker methods to avoid redundancy.
        logLevel suppresses verbose connection logging.
        onerror logs connection failures without crashing the process. */
     private async connectToServer(): Promise<any> {
       const client: any = new ImapClient.default(
         Worker.serverInfo.imap.host,
         Worker.serverInfo.imap.port,
         { auth: Worker.serverInfo.imap.auth }
       );
       client.logLevel = client.LOG_LEVEL_NONE;
       client.onerror = (inError: Error) => {
         console.log("IMAP.Worker.connectToServer(): Connection error", inError);
       };
       await client.connect();
       return client;
     }
   
     /* Returns a flat array of all mailboxes in the account.
        Gmail returns mailboxes as a nested hierarchy. iterateChildren()
        recurses through that hierarchy and flattens it into a single array
        containing only name and path for each mailbox. */
     public async listMailboxes(): Promise<IMailbox[]> {
       const client: any = await this.connectToServer();
       const mailboxes: any = await client.listMailboxes();
       await client.close();
       const finalMailboxes: IMailbox[] = [];
       const iterateChildren: Function = (inArray: any[]): void => {
         inArray.forEach((inValue: any) => {
           finalMailboxes.push({
             name: inValue.name, path: inValue.path
           });
           iterateChildren(inValue.children);
         });
       };
       iterateChildren(mailboxes.children);
       return finalMailboxes;
     }
   
     /* Returns message headers for all messages in the specified mailbox.
        "1:*" retrieves all messages from the first to the last.
        Only uid and envelope are fetched -- body is excluded to save bandwidth.
        Returns an empty array if the mailbox contains no messages. */
     public async listMessages(inCallOptions: ICallOptions):
       Promise<IMessage[]> {
       const client: any = await this.connectToServer();
       const mailbox: any = await client.selectMailbox(inCallOptions.mailbox);
       if (mailbox.exists === 0) {
         await client.close();
         return [];
       }
       const messages: any[] = await client.listMessages(
         inCallOptions.mailbox, "1:*", ["uid", "envelope"]
       );
       await client.close();
       const finalMessages: IMessage[] = [];
       messages.forEach((inValue: any) => {
         finalMessages.push({
           id: inValue.uid, date: inValue.envelope.date,
           from: inValue.envelope.from[0].address,
           subject: inValue.envelope.subject
         });
       });
       return finalMessages;
     }
   
     /* Retrieves the full body of a specific message by uid.
        "body[]" requests the full message content as an array of parts.
        { byUid: true } tells the client the id is a unique identifier,
        not an ordinal position. simpleParser extracts the plain text body. */
     public async getMessageBody(inCallOptions: ICallOptions):
       Promise<string> {
       const client: any = await this.connectToServer();
       const messages: any[] = await client.listMessages(
         inCallOptions.mailbox, inCallOptions.id,
         ["body[]"], { byUid: true }
       );
       const parsed: ParsedMail = await simpleParser(messages[0]["body[]"]);
       await client.close();
       return parsed.text as string;
     }
   
     /* Deletes a specific message by uid from the specified mailbox.
        { byUid: true } identifies the message by unique id, not position. */
     public async deleteMessage(inCallOptions: ICallOptions):
       Promise<any> {
       const client: any = await this.connectToServer();
       await client.deleteMessages(
         inCallOptions.mailbox, inCallOptions.id, { byUid: true }
       );
       await client.close();
     }
   
   }
