import type { SessionEvent } from "@concierge/core";

type Listener = (event: SessionEvent) => void;

/** Per-session pub/sub: the orchestrator emits, WS connections subscribe. */
class SessionBus {
  private listeners = new Map<string, Set<Listener>>();
  /** Ring buffer so a client connecting mid-run still sees earlier events. */
  private buffer = new Map<string, SessionEvent[]>();

  emit(event: SessionEvent): void {
    const buf = this.buffer.get(event.sessionId) ?? [];
    buf.push(event);
    if (buf.length > 500) buf.shift();
    this.buffer.set(event.sessionId, buf);
    for (const l of this.listeners.get(event.sessionId) ?? []) l(event);
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    for (const past of this.buffer.get(sessionId) ?? []) listener(past);
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => set.delete(listener);
  }
}

export const bus = new SessionBus();
