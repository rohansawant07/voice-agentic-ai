import { Pool } from "pg";
import { readFile } from "node:fs/promises";

export const database = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    })
  : null;
// Do not let an idle connection failure terminate the server unexpectedly.
database?.on("error", () => console.error("database connection lost"));
export async function initializeDatabase(): Promise<void> {
  if (!database) {
    if (process.env.NODE_ENV === "production")
      throw new Error("DATABASE_URL is required in production");
    return;
  }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(74001)");
    await client.query(
      await readFile(
        new URL("../migrations/001-state.sql", import.meta.url),
        "utf8",
      ),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function expireState(): Promise<void> {
  if (!database) return;
  await database.query("DELETE FROM roam_sessions WHERE expires_at < now()");
  await database.query(
    "DELETE FROM roam_events WHERE created_at < now() - interval '24 hours'",
  );
}
