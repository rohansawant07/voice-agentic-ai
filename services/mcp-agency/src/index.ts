import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serveMcp, toolResult } from "@concierge/mcp-kit";
import {
  audit,
  bookings,
  findBooking,
  findCustomer,
  refundFor,
  tickets,
} from "./store.js";

const PORT = Number(process.env.PORT ?? 8103);

function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-agency", version: "0.1.0" });

  server.registerTool(
    "lookup_customer",
    {
      description: "Find a customer by customerId or email. Always identify the customer before acting on bookings.",
      inputSchema: {
        customerId: z.string().optional(),
        email: z.string().optional(),
      },
    },
    async (q) => {
      const c = findCustomer(q);
      return toolResult(c ?? { error: "customer_not_found" });
    },
  );

  server.registerTool(
    "list_bookings",
    {
      description: "List all bookings for a customer.",
      inputSchema: { customerId: z.string() },
    },
    async ({ customerId }) =>
      toolResult(bookings.filter((b) => b.customerId === customerId)),
  );

  server.registerTool(
    "get_booking",
    {
      description: "Fetch one booking by confirmation code.",
      inputSchema: { confirmationCode: z.string() },
    },
    async ({ confirmationCode }) =>
      toolResult(findBooking(confirmationCode) ?? { error: "booking_not_found" }),
  );

  server.registerTool(
    "cancel_booking",
    {
      description:
        "DESTRUCTIVE: cancel a booking and issue the policy refund. Only call after the customer has explicitly confirmed. Refund: full ≥14 days out, 50% within 14 days, none within 48h.",
      inputSchema: {
        confirmationCode: z.string(),
        customerId: z.string(),
        confirmed: z.boolean().describe("Must be true — customer said yes"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ confirmationCode, customerId, confirmed }) => {
      if (!confirmed) {
        return toolResult({
          error: "confirmation_required",
          message: "Customer must explicitly confirm the cancellation first.",
        });
      }
      const b = findBooking(confirmationCode);
      if (!b) return toolResult({ error: "booking_not_found" });
      if (b.customerId !== customerId) return toolResult({ error: "customer_mismatch" });
      if (b.status === "cancelled" || b.status === "refund_issued") {
        return toolResult({ error: "already_cancelled", status: b.status });
      }
      const refundUSD = refundFor(b, new Date().toISOString());
      b.status = refundUSD > 0 ? "refund_issued" : "cancelled";
      audit.push({
        ts: new Date().toISOString(),
        action: "cancel_booking",
        detail: { confirmationCode, customerId, refundUSD },
      });
      const customer = findCustomer({ customerId });
      return toolResult({
        confirmationCode,
        status: b.status,
        refund: { amountUSD: refundUSD, method: customer?.paymentMethod ?? "original payment method" },
      });
    },
  );

  server.registerTool(
    "modify_booking",
    {
      description:
        "DESTRUCTIVE: change a booking's dates. Only call after the customer has explicitly confirmed. Returns the price delta (±15% of total per shifted week, mock policy).",
      inputSchema: {
        confirmationCode: z.string(),
        customerId: z.string(),
        newStartDate: z.string().describe("YYYY-MM-DD"),
        newEndDate: z.string().describe("YYYY-MM-DD"),
        confirmed: z.boolean().describe("Must be true — customer said yes"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ confirmationCode, customerId, newStartDate, newEndDate, confirmed }) => {
      if (!confirmed) {
        return toolResult({
          error: "confirmation_required",
          message: "Customer must explicitly confirm the change first.",
        });
      }
      const b = findBooking(confirmationCode);
      if (!b) return toolResult({ error: "booking_not_found" });
      if (b.customerId !== customerId) return toolResult({ error: "customer_mismatch" });
      const weeksShifted = Math.abs(Date.parse(newStartDate) - Date.parse(b.startDate)) / (7 * 86_400_000);
      const deltaUSD = Math.round(b.totalUSD * 0.15 * Math.min(weeksShifted, 2));
      const before = { startDate: b.startDate, endDate: b.endDate, totalUSD: b.totalUSD };
      b.startDate = newStartDate;
      b.endDate = newEndDate;
      b.totalUSD += deltaUSD;
      b.status = "confirmed";
      audit.push({
        ts: new Date().toISOString(),
        action: "modify_booking",
        detail: { confirmationCode, customerId, before, after: { newStartDate, newEndDate }, deltaUSD },
      });
      return toolResult({ confirmationCode, status: "confirmed", before, after: b, priceDeltaUSD: deltaUSD });
    },
  );

  server.registerTool(
    "create_ticket",
    {
      description: "Open an escalation ticket for a human agent when the request can't be resolved automatically.",
      inputSchema: {
        customerId: z.string(),
        subject: z.string(),
        body: z.string(),
      },
    },
    async ({ customerId, subject, body }) => {
      const ticketId = `TKT-${String(1000 + tickets.length)}`;
      const ticket = {
        ticketId,
        customerId,
        subject,
        body,
        status: "open" as const,
        createdAt: new Date().toISOString(),
      };
      tickets.push(ticket);
      audit.push({ ts: ticket.createdAt, action: "create_ticket", detail: { ticketId, customerId } });
      return toolResult(ticket);
    },
  );

  return server;
}

serveMcp({ name: "mcp-agency", port: PORT, createServer });
