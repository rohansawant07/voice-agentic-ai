import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { bus } from "../bus.js";
import { runTurn } from "../sessions.js";
import { sttEnabled, transcribe } from "./stt.js";
import { synthesize, ttsEnabled } from "./tts.js";

/**
 * /voice WebSocket — the spoken round-trip (README §4).
 *
 * Client → server:
 *   binary frames        mic audio chunks (MediaRecorder webm/opus)
 *   {"type":"audio_end"} utterance finished (browser-side endpointing)
 *   {"type":"text","text":"..."} text turn over the same socket (fallback path)
 *   {"type":"cancel"}    barge-in — stop streaming TTS immediately
 *
 * Server → client (JSON unless noted):
 *   {"type":"ready", sessionId, stt, tts}
 *   {"type":"transcript", text}          final STT result
 *   {"type":"reply", text}               orchestrator's spoken script
 *   {"type":"tts_start", mime} → binary audio frames → {"type":"tts_end"}
 *   {"type":"error", message}
 *
 * Agent activity (delegation/tool events) stays on /ws — same bus, same
 * sessionId — so the activity feed needs no new backend surface.
 */
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
    let ttsCancelled = false;
    let busy = false;

    const send = (msg: Record<string, unknown>) =>
      socket.send(JSON.stringify(msg));

    send({
      type: "ready",
      sessionId,
      stt: sttEnabled(),
      tts: ttsEnabled(),
    });

    async function speakAndSend(text: string): Promise<void> {
      ttsCancelled = false;
      const tts = await synthesize(text).catch((err: unknown) => {
        req.log.warn({ err }, "tts failed — text-only reply");
        return null;
      });
      if (!tts) return;
      send({ type: "tts_start", mime: tts.mime });
      const reader = tts.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || ttsCancelled) break;
        if (socket.readyState !== socket.OPEN) break;
        socket.send(value);
      }
      await reader.cancel().catch(() => {});
      send({ type: "tts_end" });
    }

    async function handleTurn(userText: string): Promise<void> {
      if (busy) {
        send({ type: "error", message: "turn already in progress" });
        return;
      }
      busy = true;
      try {
        bus.emit({
          type: "transcript_final",
          sessionId,
          ts: Date.now(),
          text: userText,
        });
        send({ type: "transcript", text: userText });
        const reply = await runTurn(sessionId, userText);
        send({ type: "reply", text: reply });
        await speakAndSend(reply);
      } catch (err) {
        req.log.error(err);
        send({ type: "error", message: "run_failed" });
        bus.emit({
          type: "error",
          sessionId,
          ts: Date.now(),
          message: "voice turn failed",
        });
      } finally {
        busy = false;
      }
    }

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
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
        case "audio_end": {
          const audio = Buffer.concat(chunks);
          chunks = [];
          if (msg.mime) mime = msg.mime;
          if (!sttEnabled()) {
            send({ type: "error", message: "VOICE_STT=none — voice disabled, use text" });
            return;
          }
          if (audio.length === 0) {
            send({ type: "error", message: "no audio received" });
            return;
          }
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
            });
          break;
        }
        case "text":
          if (msg.text?.trim()) void handleTurn(msg.text);
          break;
        case "cancel":
          ttsCancelled = true;
          break;
        default:
          send({ type: "error", message: `unknown type ${String(msg.type)}` });
      }
    });
  });
}
