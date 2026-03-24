import React from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

/* Renders a table of messages in the selected mailbox.
   Clicking a row calls showMessage(), which fetches and displays the message body. */
const MessageList = ({ state }: { state: any }) => (
  <Table stickyHeader padding="none">
    <TableHead>
      <TableRow>
        <TableCell style={{ width: 120 }}>Date</TableCell>
        <TableCell style={{ width: 300 }}>From</TableCell>
        <TableCell>Subject</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      { state.messages.map((message: any) => (
        <TableRow key={ message.id } onClick={ () => state.showMessage(message) }
          style={{ cursor: "pointer" }}>
          <TableCell>{ new Date(message.date).toLocaleDateString() }</TableCell>
          <TableCell>{ message.from }</TableCell>
          <TableCell>{ message.subject }</TableCell>
        </TableRow>
      )) }
    </TableBody>
  </Table>
);

export default MessageList;