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
   Both blocks require a host (string), port (number), and auth credentials. */
export interface IServerInfo {
  smtp: {
    host: string, port: number,
    auth: { user: string, pass: string }
  },
  imap: {
    host: string, port: number,
    auth: { user: string, pass: string }
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
