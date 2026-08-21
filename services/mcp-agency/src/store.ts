/**
 * In-memory agency store, deterministically seeded — the default ("mock mode")
 * backend for dev, CI, and evals. Postgres (DATABASE_URL) lands with M4/M5;
 * this module is the single seam to swap behind.
 */

export interface Customer {
  customerId: string;
  name: string;
  email: string;
  paymentMethod: string;
}

export interface Booking {
  confirmationCode: string;
  customerId: string;
  tripLabel: string;
  destinationCode: string;
  startDate: string;
  endDate: string;
  totalUSD: number;
  status: "confirmed" | "pending_change" | "cancelled" | "refund_issued";
}

export interface Ticket {
  ticketId: string;
  customerId: string;
  subject: string;
  body: string;
  status: "open";
  createdAt: string;
}

export interface AuditRecord {
  ts: string;
  action: string;
  detail: unknown;
}

export const customers: Customer[] = [
  { customerId: "cus_1001", name: "Avery Chen", email: "avery@example.com", paymentMethod: "Visa ····4242" },
  { customerId: "cus_1002", name: "Jordan Blake", email: "jordan@example.com", paymentMethod: "Amex ····3005" },
  { customerId: "cus_1003", name: "Sam Rivera", email: "sam@example.com", paymentMethod: "Mastercard ····8810" },
];

export const bookings: Booking[] = [
  {
    confirmationCode: "CNC-7H2KQ",
    customerId: "cus_1001",
    tripLabel: "Denver ski weekend",
    destinationCode: "DEN",
    startDate: "2026-09-18",
    endDate: "2026-09-21",
    totalUSD: 1412,
    status: "confirmed",
  },
  {
    confirmationCode: "CNC-9XM3P",
    customerId: "cus_1001",
    tripLabel: "Maui anniversary",
    destinationCode: "HNL",
    startDate: "2026-11-05",
    endDate: "2026-11-12",
    totalUSD: 4890,
    status: "confirmed",
  },
  {
    confirmationCode: "CNC-2QRT8",
    customerId: "cus_1002",
    tripLabel: "Orlando family week",
    destinationCode: "MCO",
    startDate: "2026-10-10",
    endDate: "2026-10-17",
    totalUSD: 3120,
    status: "confirmed",
  },
  {
    confirmationCode: "CNC-5ZWL1",
    customerId: "cus_1003",
    tripLabel: "San Juan long weekend",
    destinationCode: "SJU",
    startDate: "2026-08-28",
    endDate: "2026-08-31",
    totalUSD: 1385,
    status: "confirmed",
  },
];

export const tickets: Ticket[] = [];
export const audit: AuditRecord[] = [];

export function findCustomer(q: { customerId?: string; email?: string }) {
  return customers.find(
    (c) =>
      (q.customerId && c.customerId === q.customerId) ||
      (q.email && c.email.toLowerCase() === q.email.toLowerCase()),
  );
}

export function findBooking(confirmationCode: string) {
  return bookings.find(
    (b) => b.confirmationCode.toUpperCase() === confirmationCode.toUpperCase(),
  );
}

/** Refund policy: full refund ≥14 days out, 50% within 14 days, 0% within 48h. */
export function refundFor(b: Booking, nowIso: string): number {
  const daysOut = (Date.parse(b.startDate) - Date.parse(nowIso)) / 86_400_000;
  if (daysOut >= 14) return b.totalUSD;
  if (daysOut >= 2) return Math.round(b.totalUSD * 0.5);
  return 0;
}
