import React from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import InputBase from "@mui/material/InputBase";

/* Shows a message (currentView "message") or compose screen (currentView "compose").
   Fields are conditionally shown/hidden based on currentView.
   When viewing: ID, date, From are shown read-only. Reply and Delete buttons appear.
   When composing: To and Subject are editable. Send button appears. */
const MessageView = ({ state }: { state: any }) => (
  <form>
    {/* ID field: read-only, only shown when viewing a message.
        InputBase is used instead of TextField because it is simpler for non-editable display. */}
    { state.currentView === "message" &&
      <InputBase defaultValue={ `ID ${state.messageID}` }
        margin="dense" disabled={ true } fullWidth={ true }
        className="messageInfoField" />
    }
    { state.currentView === "message" && <br /> }

    {/* Date field: read-only, only shown when viewing a message. */}
    { state.currentView === "message" &&
      <InputBase defaultValue={ state.messageDate }
        margin="dense" disabled={ true } fullWidth={ true }
        className="messageInfoField" />
    }
    { state.currentView === "message" && <br /> }

    {/* From field: read-only, only shown when viewing a message. */}
    { state.currentView === "message" &&
      <TextField margin="dense" variant="outlined" fullWidth={ true } label="From"
        value={ state.messageFrom || "" }
        disabled={ true }
        InputProps={{ style: { color: "#000000" } }} />
    }
    { state.currentView === "message" && <br /> }

    {/* To field: editable, only shown when composing.
        id="messageTo" matches state.messageTo for fieldChangeHandler. */}
    { state.currentView === "compose" &&
      <TextField margin="dense" id="messageTo" variant="outlined"
        fullWidth={ true } label="To"
        value={ state.messageTo || "" }
        InputProps={{ style: { color: "#000000" } }}
        onChange={ state.fieldChangeHandler } />
    }
    { state.currentView === "compose" && <br /> }

    {/* Subject: editable when composing, read-only when viewing. */}
    <TextField margin="dense" id="messageSubject" label="Subject"
      variant="outlined" fullWidth={ true }
      value={ state.messageSubject || "" }
      disabled={ state.currentView === "message" }
      InputProps={{ style: { color: "#000000" } }}
      onChange={ state.fieldChangeHandler } />
    <br />

    {/* Body: multiline textarea, editable when composing, read-only when viewing.
        rows={12} sets the visible height. multiline renders an HTML textarea underneath. */}
    <TextField margin="dense" id="messageBody" variant="outlined"
      fullWidth={ true } multiline={ true } rows={ 12 }
      value={ state.messageBody || "" }
      disabled={ state.currentView === "message" }
      InputProps={{ style: { color: "#000000" } }}
      onChange={ state.fieldChangeHandler } />

    {/* Send button: only shown when composing. */}
    { state.currentView === "compose" &&
      <Button variant="contained" color="primary" size="small"
        style={{ marginTop: 10 }}
        onClick={ state.sendMessage }>
        Send
      </Button>
    }

    {/* Reply button: only shown when viewing a message. */}
    { state.currentView === "message" &&
      <Button variant="contained" color="primary" size="small"
        style={{ marginTop: 10, marginRight: 10 }}
        onClick={ () => state.showComposeMessage("reply") }>
        Reply
      </Button>
    }

    {/* Delete button: only shown when viewing a message. */}
    { state.currentView === "message" &&
      <Button variant="contained" color="primary" size="small"
        style={{ marginTop: 10 }}
        onClick={ state.deleteMessage }>
        Delete
      </Button>
    }
  </form>
);

export default MessageView;