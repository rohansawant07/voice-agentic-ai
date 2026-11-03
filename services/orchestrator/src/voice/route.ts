import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { bus } from "../bus.js";
import { runTurn } from "../sessions.js";
import { SessionBusyError, CapacityError } from "../session-store.js";
import { liveSttKey, sttEnabled, transcribe } from "./stt.js";
import { synthesize, ttsEnabled } from "./tts.js";
import { openFlux, type FluxStream } from "./flux.js";

/**
 * /voice WebSocket — the spoken round-trip (README §4).
 *
 * Live conversation (VOICE_STT=deepgram):
 *   {"type":"live_start"} → binary 16 kHz mono linear16 frames → {"type":"live_stop"}
 *   Deepgram Flux decides when each turn ends; the mic stays open between turns.
 *
 * Push-to-talk fallback (any STT provider):
 *   binary frames        mic audio chunks (MediaRecorder webm/opus or mp4)
 *   {"type":"audio_reset"} new utterance starting — drop buffered chunks
 *   {"type":"audio_end"} utterance finished (browser-side endpointing)
 *
 * Either mode:
 *   {"type":"text","text":"..."} text turn over the same socket
 *   {"type":"cancel"}    barge-in — stop streaming TTS immediately
 *
 * Server → client (JSON unless noted):
 *   {"type":"ready", sessionId, stt, tts, live}
 *   {"type":"live_started"} / {"type":"live_stopped", reason}
 *   {"type":"transcript_partial", text}  words heard so far this turn
 *   {"type":"transcript", text}          final STT result
 *   {"type":"reply", text}               orchestrator's spoken script
 *   {"type":"tts_start", mime} → binary audio frames → {"type":"tts_end"}
 *   {"type":"error", message}
 *
 * Agent activity (delegation/tool events) stays on /ws — same bus, same
 * sessionId — so the activity feed needs no new backend surface.
 */

/** Hard cap on one hands-free conversation, and on silence within it. */
const LIVE_MAX_MS = 15 * 60_000;
const LIVE_IDLE_MS = 2 * 60_000;
/** Spoken while specialists work, so a long turn doesn't sound like silence. */
const STATUS_DELAY_MS = 600;

const SPOKEN_AGENTS: Record<string, string> = {
  "flight-agent": "flights",
  "hotel-agent": "places to stay",
  "car-rental-agent": "rental cars",
  "itinerary-agent": "an itinerary",
  "budget-agent": "the budget",
  "support-agent": "your bookings",
};

export function statusLine(agentIds: string[]): string | null {
  const parts = [...new Set(agentIds.map((id) => SPOKEN_AGENTS[id]).filter(Boolean))];
  if (!parts.length) return null;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `One moment, I'm checking ${list}.`;
}

export function registerVoiceRoute(
  app: FastifyInstance,
  originAllowed: (origin: string | undefined) => boolean,
): void {
  app.get("/voice", { websocket: true }, (socket, req) => {
    if (!originAllowed(req.headers.origin)) {
      socket.close(1008, "origin not allowed");
      return;
    }
    const sessionId =
      (req.query as { sessionId?: string }).sessionId ?? randomUUID();

    let chunks: Buffer[] = [];
    let mime = "audio/webm";
    let busy = false;
    let transcribing = false;
    let lastInputAt = 0;
    let live: FluxStream | null = null;
    let liveTimers: ReturnType<typeof setTimeout>[] = [];
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    // Speech plays one clip at a time; a barge-in skips everything queued.
    let speech = Promise.resolve();
    let speechGeneration = 0;

    const send = (msg: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    send({
      type: "ready",
      sessionId,
      stt: sttEnabled(),
      tts: ttsEnabled(),
      live: Boolean(liveSttKey()),
    });

    async function speakAndSend(text: string, generation: number): Promise<void> {
      if (generation !== speechGeneration) return;
      const tts = await synthesize(text).catch((err: unknown) => {
        req.log.warn({ err }, "tts failed — text-only reply");
        return null;
      });
      if (!tts) return;
      send({ type: "tts_start", mime: tts.mime });
      const reader = tts.stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || generation !== speechGeneration) break;
          if (socket.readyState !== socket.OPEN) break;
          socket.send(value);
        }
      } catch (err) {
        req.log.warn({ err }, "tts stream failed");
      }
      await reader.cancel().catch(() => {});
      send({ type: "tts_end" });
    }

    const speak = (text: string) => {
      const generation = speechGeneration;
      speech = speech.then(() => speakAndSend(text, generation));
      return speech;
    };

    async function handleTurn(userText: string): Promise<void> {
      if (busy) {
        send({ type: "error", message: "turn already in progress" });
        return;
      }
      busy = true;
      // In a live conversation, say what is happening once specialists start.
      let unsubscribe = () => {};
      let statusTimer: ReturnType<typeof setTimeout> | undefined;
      if (live && ttsEnabled()) {
        const agents: string[] = [];
        let spoken = false;
        unsubscribe = bus.subscribe(sessionId, (event) => {
          if (event.type !== "delegation_started" || spoken) return;
          agents.push(event.agentId);
          // Delegations arrive in a burst; wait for it to settle, then speak once.
          clearTimeout(statusTimer);
          statusTimer = setTimeout(() => {
            spoken = true;
            const line = statusLine(agents);
            if (line && busy) void speak(line);
          }, STATUS_DELAY_MS);
        });
      }
      try {
        await bus.emit({
          type: "transcript_final",
          sessionId,
          ts: Date.now(),
          text: userText,
        });
        send({ type: "transcript", text: userText });
        const reply = await runTurn(sessionId, userText);
        clearTimeout(statusTimer);
        send({ type: "reply", text: reply });
        await speak(reply);
      } catch (err) {
        if (err instanceof SessionBusyError || err instanceof CapacityError) {
          send({ type: "error", message: "turn already in progress" });
          return;
        }
        req.log.error(err);
        send({ type: "error", message: "run_failed" });
        await bus.emit({
          type: "error",
          sessionId,
          ts: Date.now(),
          message: "voice turn failed",
        });
      } finally {
        clearTimeout(statusTimer);
        unsubscribe();
        busy = false;
      }
    }

    function stopLive(reason: string): void {
      if (!live) return;
      const stream = live;
      live = null;
      liveTimers.forEach(clearTimeout);
      liveTimers = [];
      clearTimeout(idleTimer);
      stream.close();
      send({ type: "live_stopped", reason });
    }

    function startLive(): void {
      const key = liveSttKey();
      if (!key) {
        send({ type: "error", message: "live voice unavailable" });
        return;
      }
      if (live) return;
      const touchIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => stopLive("idle"), LIVE_IDLE_MS);
      };
      live = openFlux(key, {
        onStart: touchIdle,
        onPartial: (text) => send({ type: "transcript_partial", text }),
        onEndOfTurn: (text) => {
          touchIdle();
          if (!text) return;
          if (busy) {
            send({ type: "error", message: "still working on the last request" });
            return;
          }
          void handleTurn(text);
        },
        onError: (message) => {
          req.log.warn({ message }, "flux error");
          send({ type: "error", message: "stt_failed" });
          stopLive("error");
        },
        onClose: () => stopLive("closed"),
      });
      liveTimers.push(setTimeout(() => stopLive("limit"), LIVE_MAX_MS));
      touchIdle();
      send({ type: "live_started" });
    }

    socket.on("close", () => {
      speechGeneration++;
      stopLive("closed");
    });

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (live) {
          // 80 ms frames are 2,560 bytes; anything far larger is not mic audio.
          if (raw.length <= 64 * 1024) live.send(raw);
          return;
        }
        const size =
          chunks.reduce((sum, chunk) => sum + chunk.length, 0) + raw.length;
        if (size > 8 * 1024 * 1024) {
          chunks = [];
          socket.close(1009, "audio limit exceeded");
          return;
        }
        chunks.push(raw);
        return;
      }
      let msg: { type?: string; text?: string; mime?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: "error", message: "invalid JSON" });
        return;
      }
      switch (msg.type) {
        case "live_start":
          startLive();
          break;
        case "live_stop":
          stopLive("user");
          break;
        case "audio_end": {
          if (busy || transcribing || Date.now() - lastInputAt < 5000) {
            chunks = [];
            send({
              type: "error",
              message: "turn already in progress or rate limited",
            });
            return;
          }
          const audio = Buffer.concat(chunks);
          chunks = [];
          if (msg.mime) mime = msg.mime;
          if (!sttEnabled()) {
            send({
              type: "error",
              message: "VOICE_STT=none — voice disabled, use text",
            });
            return;
          }
          if (audio.length === 0) {
            send({ type: "error", message: "no audio received" });
            return;
          }
          transcribing = true;
          lastInputAt = Date.now();
          void transcribe(audio, mime)
            .then(({ text }) => {
              if (!text.trim()) {
                send({ type: "transcript", text: "" });
                send({ type: "error", message: "empty transcript" });
                return;
              }
              return handleTurn(text);
            })
            .catch((err: unknown) => {
              req.log.error({ err }, "stt failed");
              send({ type: "error", message: "stt_failed" });
            })
            .finally(() => {
              transcribing = false;
            });
          break;
        }
        case "text":
          if (
            typeof msg.text === "string" &&
            msg.text.trim() &&
            msg.text.length <= 8000 &&
            !transcribing &&
            Date.now() - lastInputAt >= 5000
          ) {
            lastInputAt = Date.now();
            void handleTurn(msg.text);
          } else
            send({ type: "error", message: "invalid or rate limited message" });
          break;
        case "audio_reset":
          // client starts a fresh utterance — drop any stale/aborted chunks
          chunks = [];
          break;
        case "cancel":
          speechGeneration++;
          break;
        default:
          send({ type: "error", message: `unknown type ${String(msg.type)}` });
      }
    });
  });
}
