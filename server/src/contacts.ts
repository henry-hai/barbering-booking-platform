/*
 * Manages a local contact list using NeDB (Node Embedded Database).
 * Exports an IContact interface and a Worker class with three methods:
 * listContacts(), addContact(), deleteContact().
 */

/* path constructs the full file path to the contacts database file. */
import * as path from "path";

/* NeDB has no default export, so require() is used.
   Datastore is the NeDB class that creates and manages a database file.
   @seald-io/nedb is the maintained fork of nedb with an identical API,
   required because the original nedb package uses util.isDate which was
   removed in Node.js v22+. */
const Datastore = require("@seald-io/nedb");

/* IContact describes the shape of a contact object.
   _id is optional because NeDB auto-generates it on insert,
   it does not exist yet when a contact is first created. */
export interface IContact {
  _id?: string, name: string, email: string
}

/* Worker class instantiated by main.ts for all contact operations. */
export class Worker {

  /* db holds the NeDB Datastore instance for the lifetime of this Worker. */
  private db: any;

  /* Creates a Datastore pointed at contacts.db in the dist/ directory.
     autoload: true tells NeDB to open the file immediately on construction.
     If the file does not exist, NeDB creates it automatically. */
  constructor() {
    this.db = new Datastore({
      filename: path.join(__dirname, "contacts.db"),
      autoload: true
    });
  }

  /* Returns all contacts from the database.
     NeDB's API is callback-based, so the call is wrapped in a Promise
     to allow async/await usage in main.ts.
     An empty query object {} means "match all documents." */
  public listContacts(): Promise<IContact[]> {
    return new Promise((inResolve, inReject) => {
      this.db.find({},
        (inError: Error, inDocs: IContact[]) => {
          if (inError) {
            inReject(inError);
          } else {
            inResolve(inDocs);
          }
        }
      );
    });
  }

  /* Inserts a new contact into the database.
     NeDB adds an _id field to the inserted document automatically.
     The callback receives the newly created document including its _id,
     which is returned so main.ts can send it back to the caller. */
  public addContact(inContact: IContact): Promise<IContact> {
    return new Promise((inResolve, inReject) => {
      this.db.insert(inContact,
        (inError: Error, inNewDoc: IContact) => {
          if (inError) {
            inReject(inError);
          } else {
            inResolve(inNewDoc);
          }
        }
      );
    });
  }

  /* Removes a contact matching the given _id.
     The query { _id: inID } matches exactly one document.
     The second argument {} is an empty options object; no special
     removal options are needed when deleting by unique _id.
     Nothing is returned on success; rejection signals failure. */
  public deleteContact(inID: string): Promise<string> {
    return new Promise((inResolve, inReject) => {
      this.db.remove({ _id: inID }, {},
        (inError: Error, inNumRemoved: number) => {
          if (inError) {
            inReject(inError);
          } else {
            inResolve("");
          }
        }
      );
    });
  }

}
