import React from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

/* Shows a contact for viewing or adding.
   When currentView is "contact": fields are disabled, shows Delete and Send Email buttons.
   When currentView is "contactAdd": fields are editable, shows Save button. */
const ContactView = ({ state }: { state: any }) => (
  <form>
    {/* Name field: disabled when viewing an existing contact.
        id="contactName" must match the state property for fieldChangeHandler to work. */}
    <TextField margin="dense" id="contactName" label="Name"
      value={ state.contactName || "" }
      variant="outlined"
      InputProps={{ style: { color: "#000000" } }}
      disabled={ state.currentView === "contact" }
      style={{ width: 260 }}
      onChange={ state.fieldChangeHandler } />
    <br />

    {/* Email field: same pattern as name field. */}
    <TextField margin="dense" id="contactEmail" label="Email"
      value={ state.contactEmail || "" }
      variant="outlined"
      InputProps={{ style: { color: "#000000" } }}
      disabled={ state.currentView === "contact" }
      style={{ width: 520 }}
      onChange={ state.fieldChangeHandler } />
    <br />

    {/* Save button only visible when adding a new contact. */}
    { state.currentView === "contactAdd" &&
      <Button variant="contained" color="primary" size="small"
        style={{ marginTop: 10 }}
        onClick={ state.saveContact }>
        Save
      </Button>
    }

    {/* Delete and Send Email buttons only visible when viewing an existing contact. */}
    { state.currentView === "contact" &&
      <Button variant="contained" color="primary" size="small"
        style={{ marginTop: 10, marginRight: 10 }}
        onClick={ state.deleteContact }>
        Delete
      </Button>
    }
    { state.currentView === "contact" &&
      <Button variant="contained" color="primary" size="small"
        style={{ marginTop: 10 }}
        onClick={ () => state.showComposeMessage("contact") }>
        Send Email
      </Button>
    }
  </form>
);

export default ContactView;