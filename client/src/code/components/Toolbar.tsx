import React from "react";
import Button from "@mui/material/Button";
import EmailIcon from "@mui/icons-material/Email";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

/* Functional component: no state or lifecycle needed.
   state is destructured from the props object passed in from BaseLayout. */
const Toolbar = ({ state }: { state: any }) => (
  <div>
    {/* NEW MESSAGE button calls showComposeMessage("new") to set up blank compose fields. */}
    <Button variant="contained" color="primary" size="small"
      style={{ marginRight: 10 }}
      onClick={ () => state.showComposeMessage("new") }>
      <EmailIcon style={{ marginRight: 10 }} />New Message
    </Button>

    {/* NEW CONTACT button calls showAddContact directly.
        No anonymous function needed because no argument must be passed. */}
    <Button variant="contained" color="primary" size="small"
      style={{ marginRight: 10 }}
      onClick={ state.showAddContact }>
      <PersonAddIcon style={{ marginRight: 10 }} />New Contact
    </Button>
  </div>
);

export default Toolbar;