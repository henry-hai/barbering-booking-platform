import axios, { AxiosResponse } from "axios";
import { config } from "./config";

export interface IContact {
  _id?: string,
  name: string,
  email: string
}

export class Worker {

  /* Fetches all contacts from the server. */
  public async listContacts(): Promise<IContact[]> {
    const response: AxiosResponse = await axios.get(`${config.serverAddress}/contacts`);
    return response.data;     /* response.data is the parsed JSON body */
  }

  /* Posts a new contact to the server and returns the saved object with _id. */
  public async addContact(inContact: IContact): Promise<IContact> {
    const response: AxiosResponse = await axios.post(
      `${config.serverAddress}/contacts`, inContact
    );
    return response.data;
  }

  /* Sends a DELETE request for a specific contact by its NeDB _id. */
  public async deleteContact(inID: string | null | undefined): Promise<void> {
    await axios.delete(`${config.serverAddress}/contacts/${inID}`);
  }

}
