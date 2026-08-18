/*
 * MCP server exposing the booking system as tools.
 *
 * This is a LOCAL run mode. It speaks the Model Context Protocol over stdio,
 * so an MCP client launches it as a child process; it is not deployed, not
 * hosted, and listens on no port.
 *
 * Cost is effectively zero and it is safe to leave running. The only things it
 * touches are the Google Sheets API on a service account and the
 * same Gmail SMTP account the site already sends through. No model is called
 * and no paid API is involved.
 *
 * All behaviour lives in BookingTools. This file is the transport wrapper:
 * schemas in, JSON out.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IServerInfo } from "../ServerInfo";
import { BookingTools, IBookingToolsOptions } from "./BookingTools";

/* Rendering helper: MCP tool results are content blocks, and every tool here
   answers with one JSON object. Returning the structured form alongside the
   text lets a client use either. */
const asResult = (payload: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(payload, null, 2) }
  ],
  structuredContent: payload as Record<string, unknown>
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createMcpServer(
  inServerInfo: IServerInfo,
  options: IBookingToolsOptions = {}
): McpServer {

  const tools = new BookingTools(inServerInfo, options);

  const server = new McpServer({
    name: "henry-hai-studio-booking",
    version: "1.0.0"
  });

  server.registerTool(
    "check_availability",
    {
      title: "Check requested dates",
      description:
        "Lists the dates clients have already requested, read from the same " +
        "Google Sheet the appointments dashboard uses. Note that the sheet " +
        "holds requests rather than a confirmed calendar: a date listed here " +
        "has been asked for, which is not the same as being taken, and a date " +
        "missing from it is not a guarantee that it is free.",
      inputSchema: {
        from: z.string().regex(ISO_DATE)
          .describe("Earliest date to include, YYYY-MM-DD. Optional.")
          .optional(),
        to: z.string().regex(ISO_DATE)
          .describe("Latest date to include, YYYY-MM-DD. Optional.")
          .optional()
      }
    },
    async (args) => asResult(await tools.checkAvailability(args))
  );

  server.registerTool(
    "request_booking",
    {
      title: "Request a booking",
      description:
        "Submits an appointment request through the identical validated path " +
        "the website form uses. On success the client receives a confirmation " +
        "email, the owner receives a notification, and the server " +
        "appends the request to the booking sheet. Every field is revalidated " +
        "server side, so invalid input is rejected here exactly as it would be " +
        "on the site.",
      inputSchema: {
        name: z.string().describe("Client's full name."),
        email: z.string().describe("Client's email, where the confirmation goes."),
        phone: z.string().describe("Client's phone number, at least 7 digits."),
        date1: z.string().describe("First preferred date, YYYY-MM-DD. Required."),
        availability1: z.string()
          .describe("Times that work on the first date. Required."),
        date2: z.string()
          .describe("Second preferred date, YYYY-MM-DD. Optional, but needs " +
            "availability2 with it.")
          .optional(),
        availability2: z.string()
          .describe("Times that work on the second date.").optional(),
        date3: z.string()
          .describe("Third preferred date, YYYY-MM-DD. Optional, but needs " +
            "availability3 with it.")
          .optional(),
        availability3: z.string()
          .describe("Times that work on the third date.").optional(),
        description: z.string().describe("What the client wants done."),
        policiesAccepted: z.boolean()
          .describe("Must be true. The client has to accept the booking " +
            "policies, same as the checkbox on the site.")
      }
    },
    async (args) => asResult(await tools.requestBooking(args))
  );

  return server;
}

/* Connects the server to stdio and blocks. Errors go to stderr, never stdout,
   because stdout is the protocol channel. */
export async function runStdioServer(
  inServerInfo: IServerInfo,
  options: IBookingToolsOptions = {}
): Promise<void> {
  const server = createMcpServer(inServerInfo, options);
  await server.connect(new StdioServerTransport());
  console.error("Booking MCP server ready on stdio.");
}
