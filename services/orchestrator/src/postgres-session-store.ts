import type { Pool } from "pg";
import type { ModelMessage } from "ai";
import { SessionBusyError, CapacityError } from "./session-store.js";

/** A dedicated connection owns both locks until the complete model turn ends. */
export class PostgresSessionStore {
  constructor(
    private readonly pool: Pool,
    private readonly runner: (
      id: string,
      history: ModelMessage[],
    ) => Promise<string>,
    private readonly onStart: (id: string) => void | Promise<void> = () => {},
    private readonly capacity = 4,
  ) {}

  async runTurn(id: string, message: string): Promise<string> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [`turn:${id}`],
      );
      if (!lock.rows[0]?.locked) throw new SessionBusyError();
      locked = true;
      let admitted = false;
      for (let slot = 0; slot < this.capacity; slot++) {
        const result = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(74002, $1) AS locked",
          [slot],
        );
        if (result.rows[0]?.locked) {
          admitted = true;
          break;
        }
      }
      if (!admitted) throw new CapacityError();
      const result = await client.query<{ history: ModelMessage[] }>(
        "SELECT history FROM roam_sessions WHERE id=$1 AND expires_at > now()",
        [id],
      );
      const history = result.rows[0]?.history ?? [];
      if (history.length === 0) await this.onStart(id);
      const pending: ModelMessage[] = [
        ...history,
        { role: "user", content: message },
      ];
      const text = await this.runner(id, structuredClone(pending));
      const next = [...pending, { role: "assistant", content: text }].slice(
        -24,
      );
      await client.query(
        `INSERT INTO roam_sessions(id, history, expires_at) VALUES($1,$2,now()+interval '24 hours')
        ON CONFLICT(id) DO UPDATE SET history=excluded.history, updated_at=now(), expires_at=excluded.expires_at`,
        [id, JSON.stringify(next)],
      );
      return text;
    } finally {
      let broken = false;
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock_all()");
        } catch {
          broken = true;
        }
      }
      client.release(broken);
    }
  }
}
