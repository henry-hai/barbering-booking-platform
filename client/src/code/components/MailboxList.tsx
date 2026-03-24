import React from "react";
import List from "@mui/material/List";
import Chip from "@mui/material/Chip";

/* Renders a Chip for each mailbox in state.mailboxes.
   Chips change color when they are the currently selected mailbox. */
const MailboxList = ({ state }: { state: any }) => (
  <List>
    { state.mailboxes.map((value: any) => (
      <Chip key={ value.path }
        label={ `${value.name}` }
        onClick={ () => state.setCurrentMailbox(value.path) }   /* anonymous function passes the path */
        style={{ width: 128, marginBottom: 10 }}
        color={ state.currentMailbox === value.path ? "secondary" : "primary" }
      />
    )) }
  </List>
);

export default MailboxList;