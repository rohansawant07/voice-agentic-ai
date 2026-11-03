import WebSocket from "ws";

/**
 * Live speech-to-text with Deepgram Flux (/v2/listen). Flux transcribes while
 * the user talks and decides when their turn has ended, so the browser keeps
 * the mic open and never has to say "done". Audio is 16 kHz mono linear16.
 */

export const FLUX_SAMPLE_RATE = 16_000;
/** About 2 s of audio held while the connection opens; older audio is dropped. */
const PENDING_LIMIT = FLUX_SAMPLE_RATE * 2 * 2;

export function fluxUrl(): string {
  const url = new URL("wss://api.deepgram.com/v2/listen");
  url.searchParams.set("model", "flux-general-en");
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(FLUX_SAMPLE_RATE));
  url.searchParams.set("eot_threshold", process.env.VOICE_EOT_THRESHOLD ?? "0.7");
  url.searchParams.set("eot_timeout_ms", "5000");
  return url.toString();
}

export interface FluxHandlers {
  /** The user started speaking. */
  onStart(): void;
  /** Text heard so far in the current turn. */
  onPartial(text: string): void;
  /** The user finished speaking; the full turn's text. */
  onEndOfTurn(text: string): void;
  onError(message: string): void;
  onClose(): void;
}

export interface FluxStream {
  send(audio: Buffer): void;
  close(): void;
}

/** Minimal surface of a WebSocket so tests can stand in for Deepgram. */
export interface FluxSocket {
  readonly readyState: number;
  send(data: Buffer | string): void;
  close(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

const connectDeepgram = (url: string, key: string): FluxSocket =>
  new WebSocket(url, { headers: { Authorization: `Token ${key}` } });

export function openFlux(
  key: string,
  handlers: FluxHandlers,
  connect: (url: string, key: string) => FluxSocket = connectDeepgram,
): FluxStream {
  const socket = connect(fluxUrl(), key);
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let closed = false;

  socket.on("open", () => {
    for (const chunk of pending) socket.send(chunk);
    pending = [];
    pendingBytes = 0;
  });
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    let msg: { type?: string; event?: string; transcript?: string; description?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "Error") {
      handlers.onError(msg.description ?? "Deepgram error");
      return;
    }
    if (msg.type !== "TurnInfo") return;
    const text = (msg.transcript ?? "").trim();
    switch (msg.event) {
      case "StartOfTurn":
        handlers.onStart();
        if (text) handlers.onPartial(text);
        break;
      case "Update":
      case "EagerEndOfTurn":
      case "TurnResumed":
        if (text) handlers.onPartial(text);
        break;
      case "EndOfTurn":
        handlers.onEndOfTurn(text);
        break;
    }
  });
  socket.on("error", (err) => handlers.onError(err.message));
  socket.on("close", () => {
    closed = true;
    handlers.onClose();
  });

  return {
    send(audio) {
      if (closed) return;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(audio);
        return;
      }
      pending.push(audio);
      pendingBytes += audio.length;
      while (pendingBytes > PENDING_LIMIT && pending.length) pendingBytes -= pending.shift()!.length;
    },
    close() {
      if (closed) return;
      closed = true;
      // CloseStream lets Flux finish what it has; the socket closes after.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
        setTimeout(() => socket.close(), 1000).unref();
      } else socket.close();
    },
  };
}
