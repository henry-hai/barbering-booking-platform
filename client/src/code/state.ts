import { config } from "./config";
import * as IMAP from "./IMAP";
import * as SMTP from "./SMTP";
import * as Contacts from "./Contacts";

/* createState() returns the state object bound to the BaseLayout component.
   inParentComponent is the BaseLayout instance; all mutator methods bind to it so
   they can call this.setState() on the component that holds the state. */
export function createState(inParentComponent: any) {

  return {

    /* --- State properties --- */
    pleaseWaitVisible: false,             /* controls the loading popup visibility */
    contacts: [] as Contacts.IContact[],  /* list of saved contacts */
    mailboxes: [] as IMAP.IMailbox[],     /* list of Gmail mailboxes */
    messages: [] as IMAP.IMessage[],      /* messages in the selected mailbox */
    currentView: "welcome",               /* "welcome", "message", "compose", "contact", "contactAdd" */
    currentMailbox: null as string | null,
    messageID: null as string | null,
    messageDate: null as string | null,
    messageFrom: null as string | null,
    messageTo: null as string | null,
    messageSubject: null as string | null,
    messageBody: null as string | null,
    contactID: null as string | null,
    contactName: null as string | null,
    contactEmail: null as string | null,

    /* --- State mutator methods --- */

    /* Shows or hides the loading popup by updating pleaseWaitVisible. */
    showHidePleaseWait: function(inVisible: boolean): void {
      this.setState({ pleaseWaitVisible: inVisible });
    }.bind(inParentComponent),

    /* Appends a mailbox to the mailboxes array in state.
       slice(0) creates a copy because setState() must receive a new array reference. */
    addMailboxToList: function(inMailbox: IMAP.IMailbox): void {
      const cl: IMAP.IMailbox[] = this.state.mailboxes.slice(0);
      cl.push(inMailbox);
      this.setState({ mailboxes: cl });
    }.bind(inParentComponent),

    /* Appends a contact to the contacts array in state. */
    addContactToList: function(inContact: Contacts.IContact): void {
      const cl = this.state.contacts.slice(0);
      cl.push({ _id: inContact._id, name: inContact.name, email: inContact.email });
      this.setState({ contacts: cl });
    }.bind(inParentComponent),

    /* Sets currentMailbox and triggers message list fetch. */
    setCurrentMailbox: function(inPath: string): void {
      this.setState({ currentView: "welcome", currentMailbox: inPath });
      this.state.getMessages(inPath);
    }.bind(inParentComponent),

    /* Fetches message headers for the given mailbox path from the server. */
    getMessages: async function(inPath: string): Promise<void> {
      this.state.showHidePleaseWait(true);
      const imapWorker: IMAP.Worker = new IMAP.Worker();
      const messages: IMAP.IMessage[] = await imapWorker.listMessages(inPath);
      this.state.showHidePleaseWait(false);
      this.state.clearMessages();
      messages.forEach((inMessage: IMAP.IMessage) => {
        this.state.addMessageToList(inMessage);
      });
    }.bind(inParentComponent),

    /* Clears the message list by setting an empty array. */
    clearMessages: function(): void {
      this.setState({ messages: [] });
    }.bind(inParentComponent),

    /* Appends a message to the messages array in state. */
    addMessageToList: function(inMessage: IMAP.IMessage): void {
      const cl = this.state.messages.slice(0);
      cl.push({ id: inMessage.id, date: inMessage.date,
        from: inMessage.from, subject: inMessage.subject });
      this.setState({ messages: cl });
    }.bind(inParentComponent),

    /* Sets state to show a contact's details in the view area. */
    showContact: function(inID: string, inName: string, inEmail: string): void {
      this.setState({ currentView: "contact", contactID: inID,
        contactName: inName, contactEmail: inEmail });
    }.bind(inParentComponent),

    /* Saves a new contact to the server and adds it to state. */
    saveContact: async function(): Promise<void> {
      const cl = this.state.contacts.slice(0);
      this.state.showHidePleaseWait(true);
      const contactsWorker: Contacts.Worker = new Contacts.Worker();
      const contact: Contacts.IContact = await contactsWorker.addContact({
        name: this.state.contactName,
        email: this.state.contactEmail
      });
      this.state.showHidePleaseWait(false);
      cl.push(contact);
      this.setState({ contacts: cl, contactID: null,
        contactName: "", contactEmail: "" });
    }.bind(inParentComponent),

    /* Deletes a contact from the server and removes it from state.
       filter() returns a new array excluding the deleted contact. */
    deleteContact: async function(): Promise<void> {
      this.state.showHidePleaseWait(true);
      const contactsWorker: Contacts.Worker = new Contacts.Worker();
      await contactsWorker.deleteContact(this.state.contactID);
      this.state.showHidePleaseWait(false);
      const cl = this.state.contacts.filter(
        (inElement: Contacts.IContact) => inElement._id != this.state.contactID
      );
      this.setState({ contacts: cl, contactID: null,
        contactName: "", contactEmail: "" });
    }.bind(inParentComponent),

    /* Sets state to show compose view for new message, reply, or contact email.
       inType is "new", "reply", or "contact" and determines how fields are pre-filled. */
    showComposeMessage: function(inType: string): void {
      switch (inType) {
        case "new":
          this.setState({ currentView: "compose",
            messageTo: "", messageSubject: "", messageBody: "",
            messageFrom: config.userEmail });
          break;
        case "reply":
          this.setState({ currentView: "compose",
            messageTo: this.state.messageFrom,
            messageSubject: `Re: ${this.state.messageSubject}`,
            messageFrom: config.userEmail,
            messageBody: `\n\n---- Original Message ----\n\n${this.state.messageBody}` });
          break;
        case "contact":
          this.setState({ currentView: "compose",
            messageTo: this.state.contactEmail,
            messageSubject: "", messageBody: "",
            messageFrom: config.userEmail });
          break;
      }
    }.bind(inParentComponent),

    /* Sets state to show the add contact form with empty fields. */
    showAddContact: function(): void {
      this.setState({ currentView: "contactAdd",
        contactID: null, contactName: "", contactEmail: "" });
    }.bind(inParentComponent),

    /* Generic onChange handler for all TextField components.
       inEvent.target.id matches the state property name (e.g. "contactName", "messageTo").
       This allows one handler to update the correct state property for any input field.
       Square bracket notation [inEvent.target.id] uses the id as a dynamic key. */
    fieldChangeHandler: function(inEvent: any): void {
      if (inEvent.target.id === "contactName" &&
          inEvent.target.value.length > 16) { return; }
      this.setState({ [inEvent.target.id]: inEvent.target.value });
    }.bind(inParentComponent),

    /* Fetches the body of a message from the server and updates state to show it. */
    showMessage: async function(inMessage: IMAP.IMessage): Promise<void> {
      this.state.showHidePleaseWait(true);
      const imapWorker: IMAP.Worker = new IMAP.Worker();
      const mb: string = await imapWorker.getMessageBody(
        inMessage.id, this.state.currentMailbox
      );
      this.state.showHidePleaseWait(false);
      this.setState({ currentView: "message",
        messageID: inMessage.id, messageDate: inMessage.date,
        messageFrom: inMessage.from,
        messageTo: "", messageSubject: inMessage.subject,
        messageBody: mb });
    }.bind(inParentComponent),

    /* Sends a message via the server SMTP endpoint and returns to welcome view. */
    sendMessage: async function(): Promise<void> {
      this.state.showHidePleaseWait(true);
      const smtpWorker: SMTP.Worker = new SMTP.Worker();
      await smtpWorker.sendMessage(this.state.messageTo, this.state.messageFrom,
        this.state.messageSubject, this.state.messageBody);
      this.state.showHidePleaseWait(false);
      this.setState({ currentView: "welcome" });
    }.bind(inParentComponent),

    /* Deletes a message via the server IMAP endpoint and removes it from state.
       filter() removes the deleted message from the messages list. */
    deleteMessage: async function(): Promise<void> {
      this.state.showHidePleaseWait(true);
      const imapWorker: IMAP.Worker = new IMAP.Worker();
      await imapWorker.deleteMessage(this.state.messageID, this.state.currentMailbox);
      this.state.showHidePleaseWait(false);
      const cl = this.state.messages.filter(
        (inElement: IMAP.IMessage) => inElement.id != this.state.messageID
      );
      this.setState({ messages: cl, currentView: "welcome" });
    }.bind(inParentComponent)

  };

}
