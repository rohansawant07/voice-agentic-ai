import type { Pool } from "pg";
import type { SessionEvent } from "@concierge/core";

/** Shared replay log. Polling deliberately avoids a paid Redis service for the pilot. */
export class PostgresBus {
  constructor(private readonly pool: Pool) {}
  async emit(event: SessionEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize insertion/commit per session, so readers cannot skip a late commit.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`event:${event.sessionId}`],
      );
      await client.query(
        "INSERT INTO roam_events(session_id,payload) VALUES($1,$2)",
        [event.sessionId, JSON.stringify(event)],
      );
      await client.query(
        "DELETE FROM roam_events WHERE session_id=$1 AND id < (SELECT id FROM roam_events WHERE session_id=$1 ORDER BY id DESC OFFSET 499 LIMIT 1)",
        [event.sessionId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  subscribe(
    id: string,
    listener: (event: SessionEvent) => void,
    onError: () => void = () => {},
  ): () => void {
    let stopped = false,
      reading = false,
      cursor = "0";
    const read = async () => {
      if (stopped || reading) return;
      reading = true;
      try {
        const result = await this.pool.query<{
          id: string;
          payload: SessionEvent;
        }>(
          "SELECT id,payload FROM roam_events WHERE session_id=$1 AND id>$2 AND created_at > now()-interval '24 hours' ORDER BY id LIMIT 500",
          [id, cursor],
        );
        for (const row of result.rows) {
          if (stopped) break;
          listener(row.payload);
          cursor = row.id;
        }
      } catch {
        if (!stopped) onError();
      } finally {
        reading = false;
      }
    };
    const timer = setInterval(() => void read(), 500);
    timer.unref();
    void read();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
