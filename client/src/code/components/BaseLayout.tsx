import React, { Component } from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText } from "@mui/material";
import { createState } from "../state";
import * as IMAP from "../IMAP";
import * as Contacts from "../Contacts";
import Toolbar from "./Toolbar";
import MailboxList from "./MailboxList";
import ContactList from "./ContactList";
import MessageList from "./MessageList";
import WelcomeView from "./WelcomeView";
import ContactView from "./ContactView";
import MessageView from "./MessageView";

/* Root component that holds all state and lays out the CSS Grid.
   All child components receive state as a prop. */
class BaseLayout extends Component {

  /* createState() is called once and bound to this BaseLayout instance. */
  state = createState(this);

  /* componentDidMount() is a React lifecycle method that runs once after the component
     is fully mounted in the DOM. This is the correct place to make startup server calls
     because this.state methods are guaranteed to work here.
     The textbook does this in main.tsx but that approach requires a direct component
     reference which is not available in React 18's asynchronous createRoot API. */
  async componentDidMount() {
    this.state.showHidePleaseWait(true);          /* show loading popup during startup */

    /* Fetch mailboxes and set the entire array at once.
       React 18 batches setState calls made in a loop, so calling addMailboxToList()
       per item would overwrite each result with the next. Setting the full array
       in a single setState call avoids this. */
    try {
      const imapWorker: IMAP.Worker = new IMAP.Worker();
      const mailboxes: IMAP.IMailbox[] = await imapWorker.listMailboxes();
      this.setState({ mailboxes: mailboxes });
    } catch (e) { console.error("Error loading mailboxes:", e); }

    /* Same approach for contacts. */
    try {
      const contactsWorker: Contacts.Worker = new Contacts.Worker();
      const contacts: Contacts.IContact[] = await contactsWorker.listContacts();
      this.setState({ contacts: contacts });
    } catch (e) { console.error("Error loading contacts:", e); }

    this.state.showHidePleaseWait(false);         /* hide loading popup when done */
  }

  render() {
    return (
      <div className="appContainer">

        {/* Loading popup shown during server calls.
            open is controlled by state.pleaseWaitVisible.
            disableEscapeKeyDown prevents user dismissal. */}
        <Dialog open={ this.state.pleaseWaitVisible }
          disableEscapeKeyDown={ true }
          transitionDuration={ 0 }>
          <DialogTitle style={{ textAlign: "center" }}>Please Wait</DialogTitle>
          <DialogContent>
            <DialogContentText>...Contacting server...</DialogContentText>
          </DialogContent>
        </Dialog>

        {/* Toolbar spans all three columns of the grid. */}
        <div className="toolbar">
          <Toolbar state={ this.state } />
        </div>

        {/* Mailbox list in the left column. */}
        <div className="mailboxList">
          <MailboxList state={ this.state } />
        </div>

        {/* Center area is a nested grid: message list on top, view area below. */}
        <div className="centerArea">
          <div className="messageList">
            <MessageList state={ this.state } />
          </div>
          <div className="centerViews">
            {/* Conditional rendering: only one view renders at a time. */}
            { this.state.currentView === "welcome" && <WelcomeView /> }
            { (this.state.currentView === "message" ||
               this.state.currentView === "compose") &&
              <MessageView state={ this.state } />
            }
            { (this.state.currentView === "contact" ||
               this.state.currentView === "contactAdd") &&
              <ContactView state={ this.state } />
            }
          </div>
        </div>

        {/* Contact list in the right column. */}
        <div className="contactList">
          <ContactList state={ this.state } />
        </div>

      </div>
    );
  }

}

export default BaseLayout;