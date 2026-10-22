import type { ModelMessage } from "ai";

export class SessionBusyError extends Error {
  constructor() {
    super("turn already in progress");
    this.name = "SessionBusyError";
  }
}

type Runner = (sessionId: string, history: ModelMessage[]) => Promise<string>;

/** Process-local history. A turn commits both messages only after success. */
export class SessionStore {
  private histories = new Map<string, ModelMessage[]>();
  private active = new Set<string>();

  constructor(
    private readonly runner: Runner,
    private readonly onStart: (sessionId: string) => void = () => {},
  ) {}

  async runTurn(sessionId: string, message: string): Promise<string> {
    // Acquire before any await: HTTP and voice share this guard.
    if (this.active.has(sessionId)) throw new SessionBusyError();
    this.active.add(sessionId);
    try {
      const committed = this.histories.get(sessionId) ?? [];
      if (committed.length === 0) this.onStart(sessionId);
      const pending: ModelMessage[] = [
        ...structuredClone(committed),
        { role: "user", content: message },
      ];
      const text = await this.runner(sessionId, pending);
      this.histories.set(sessionId, [
        ...pending,
        { role: "assistant", content: text },
      ]);
      return text;
    } finally {
      this.active.delete(sessionId);
    }
  }
}
