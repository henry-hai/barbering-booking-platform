/*
 * Reads serverInfo.json from the file system using Node's fs module.
 * Exports an IServerInfo interface and a parsed config object.
 * IMAP.ts and SMTP.ts import serverInfo from this file to get
 * the credentials needed to connect to Gmail.
 */

/* Node built-in modules: path constructs file paths, fs reads files. */
const path = require("path");
const fs = require("fs");

/* Interface describing the shape of the SMTP and IMAP config.
   Both blocks require a host (string), port (number), and auth credentials.
   The optional sheets block points the appointments dashboard at the Google
   Sheet the booking log lives in. */
export interface IServerInfo {
  smtp: {
    host: string, port: number,
    auth: { user: string, pass: string }
  },
  imap: {
    host: string, port: number,
    auth: { user: string, pass: string }
  },
  sheets?: {
    /* The A1 range Appointments.ts asks Google for. It must reach at least as
       far right as the last column the workflow writes, currently L.

       Worth knowing because getting this wrong fails silently: a range of
       A:K against a sheet holding twelve columns returns eleven, the reader
       finds nothing at row[11], and the field simply never appears. Nothing
       errors and no log mentions it. Widen this before adding a column. */
    spreadsheetId: string,
    range: string
  }
}

/* Exported variable imported by IMAP.ts and SMTP.ts. */
export let serverInfo: IServerInfo;

/* __dirname is the directory of the currently running script (dist/ after compilation).
   "../serverInfo.json" navigates up one level to server/ where the config file lives.
   readFileSync loads the entire file into memory as a string. */
const rawInfo: string =
  fs.readFileSync(path.join(__dirname, "../serverInfo.json"));

/* JSON.parse converts the raw string into a structured JavaScript object. */
serverInfo = JSON.parse(rawInfo);
