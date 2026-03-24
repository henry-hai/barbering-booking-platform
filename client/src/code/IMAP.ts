import axios, { AxiosResponse } from "axios";
import { config } from "./config";

export interface IMailbox { name: string, path: string }

export interface IMessage {
  id: string, date: string, from: string, subject: string, body?: string
}

export class Worker {

  /* Gets all mailbox names and paths from the server. */
  public async listMailboxes(): Promise<IMailbox[]> {
    const response: AxiosResponse = await axios.get(`${config.serverAddress}/mailboxes`);
    return response.data;
  }

  /* Gets message headers for a specific mailbox path. */
  public async listMessages(inMailbox: string): Promise<IMessage[]> {
    const response: AxiosResponse = await axios.get(
      `${config.serverAddress}/mailboxes/${inMailbox}`
    );
    return response.data;
  }

  /* Gets the full text body of a specific message by ID and mailbox. */
  public async getMessageBody(inID: string, inMailbox: string): Promise<string> {
    const response: AxiosResponse = await axios.get(
      `${config.serverAddress}/messages/${inMailbox}/${inID}`
    );
    return response.data;
  }

  /* Sends a DELETE request for a specific message by ID and mailbox. */
  public async deleteMessage(inID: string, inMailbox: string): Promise<void> {
    await axios.delete(`${config.serverAddress}/messages/${inMailbox}/${inID}`);
  }

}
