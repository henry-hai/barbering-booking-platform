import axios, { AxiosResponse } from "axios";
import { config } from "./config";

/* One preferred slot a client offered when requesting a booking. */
export interface IPreferredSlot { date: string, availability: string }

/* A booking request as returned by the server's /appointments endpoint
   (sourced from the Google Sheet the booking endpoint appends to). */
export interface IBookingRequest {
  name: string,
  submittedDate: string,
  submittedTime: string,
  phone: string,
  preferred: IPreferredSlot[],
  notes: string,
  /* Column L, appended after A..K were in use. Empty for rows written before
     that column existed. */
  email: string
}

export class Worker {

  /* Gets all booking requests from the server (newest first). Guards against
     a non-array response so the dashboard never crashes on an error. */
  public async listAppointments(): Promise<IBookingRequest[]> {
    const response: AxiosResponse = await axios.get(
      `${config.serverAddress}/appointments`
    );
    return Array.isArray(response.data) ? response.data : [];
  }

}