import React from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import Person from "@mui/icons-material/Person";

/* Renders a ListItem for each contact in state.contacts.
   Each item shows a Person icon avatar and the contact's name.
   Clicking a contact calls showContact() to display it in the view area. */
const ContactList = ({ state }: { state: any }) => (
  <List>
    { state.contacts.map((value: any) => (
      <ListItem key={ value._id } onClick={ () =>
        state.showContact(value._id, value.name, value.email)
      }>
        <ListItemAvatar>
          <Avatar><Person /></Avatar>
        </ListItemAvatar>
        <ListItemText primary={ `${value.name}` } />
      </ListItem>
    )) }
  </List>
);

export default ContactList;