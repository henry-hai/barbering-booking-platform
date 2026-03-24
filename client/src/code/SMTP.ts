import axios from "axios";
import { config } from "./config";

export class Worker {

  /* Posts a message object to the server, which sends it via Gmail SMTP.
     Axios automatically serializes the object to JSON and sets Content-Type header. */
  public async sendMessage(
    inTo: string, inFrom: string, inSubject: string, inMessage: string
  ): Promise<void> {
    await axios.post(`${config.serverAddress}/messages`, {
      to: inTo,
      from: inFrom,
      subject: inSubject,
      text: inMessage
    });
  }

}
