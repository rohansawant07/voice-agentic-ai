"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEvent } from "@concierge/core";

export const ORCH_URL =
  process.env.NEXT_PUBLIC_ORCH_URL ?? "http://localhost:8080";
const socketBase = () => (ORCH_URL || window.location.origin).replace(/^http/, "ws");

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
  /** Server event time for assistant messages; dedupes socket replays. */
  ts?: number;
}

export interface AgentActivity {
  sources?: { url: string; title?: string; retrievedAt: string }[];
  agentId: string;
  state: "running" | "done" | "failed" | "needs_input";
  task: string;
  tools: { tool: string; argsPreview: Record<string, unknown>; ts: number }[];
  summary?: string;
  data?: unknown;
  durationMs?: number;
  startedAt: number;
  finishedAt?: number;
}

export type Connection = "connecting" | "open" | "reconnecting";
/** "off" means the server has no speech-to-text configured. */
export type VoiceStatus = "connecting" | "ready" | "off";

/** What to tell the customer when the voice socket reports a problem. */
const VOICE_ISSUES: [RegExp, string][] = [
  [/empty transcript|no audio/, "I didn't catch that. Hold the mic a little longer, or type your message below."],
  [/rate limited|in progress/, "Give me a few seconds between voice messages, then try again."],
  [/stt_failed/, "I couldn't transcribe that. Try again, or type your message below."],
  [/run_failed/, "I couldn't complete that request. Please try again in a moment."],
];
const VOICE_DROPPED = "The voice connection dropped. Try again in a moment.";
export const voiceIssueFor = (message = "") =>
  VOICE_ISSUES.find(([pattern]) => pattern.test(message))?.[1] ??
  "Voice input didn't work that time. Try again, or type your message below.";

const STORAGE_KEY = "roam.session.v1";

interface StoredSession {
  sessionId: string;
  messages: ChatMessage[];
}

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return typeof parsed.sessionId === "string" && Array.isArray(parsed.messages)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredSession | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the trip simply won't survive a refresh.
  }
}

const newSessionId = () =>
  "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Math.random().toString(36).slice(2)}`;

export interface SessionState {
  sessionId: string;
  messages: ChatMessage[];
  agents: Map<string, AgentActivity>;
  orb: OrbState;
  runningCount: number;
  voiceAvailable: boolean;
  voice: VoiceStatus;
  /** The last voice problem, in words for the customer; cleared on the next attempt. */
  voiceIssue: string;
  connection: Connection;
  sendText: (text: string) => void;
  newTrip: () => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  stopSpeaking: () => void;
}

/**
 * One hook = one conversation session. Wires both sockets:
 *  /ws     — agent activity feed (delegations, tools, results)
 *  /voice  — mic frames up, transcript/reply/TTS audio down
 */
export function useSession(): SessionState {
  // Client-only: SSR renders with an empty id, avoiding hydration mismatch.
  // A stored session resumes after refresh; the server replays its events.
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setMessages(stored.messages.filter((m) => !m.partial));
      setSessionId(stored.sessionId);
    } else setSessionId(newSessionId());
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    const settled = messages.filter((m) => !m.partial);
    writeStored(settled.length ? { sessionId, messages: settled } : null);
  }, [sessionId, messages]);
  const [agents, setAgents] = useState<Map<string, AgentActivity>>(new Map());
  const [orb, setOrb] = useState<OrbState>("idle");
  const [voice, setVoice] = useState<VoiceStatus>("connecting");
  const [voiceIssue, setVoiceIssue] = useState("");
  const [connection, setConnection] = useState<Connection>("connecting");
  const runningCount = [...agents.values()].filter(
    (a) => a.state === "running",
  ).length;

  const voiceWs = useRef<WebSocket | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Uint8Array[]>([]);
  const player = useRef<HTMLAudioElement | null>(null);
  /** Audio was sent and the server has not answered with a transcript or error yet. */
  const awaitingTranscript = useRef(false);

  // ── /ws activity feed ────────────────────────────────────────
  // Every (re)connect replays the session's events. Handlers are idempotent
  // (keyed by event ts), so a replay never duplicates what is already shown
  // and a server that lost its history doesn't wipe the visible board.
  useEffect(() => {
    if (!sessionId) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let closed = false;

    const handle = (ev: SessionEvent) => {
      switch (ev.type) {
        case "delegation_started":
          setAgents((prev) => {
            if (prev.get(ev.agentId)?.startedAt === ev.ts) return prev;
            const next = new Map(prev);
            next.set(ev.agentId, {
              agentId: ev.agentId,
              state: "running",
              task: ev.task,
              tools: [],
              startedAt: ev.ts,
            });
            return next;
          });
          break;
        case "tool_called":
          setAgents((prev) => {
            const a = prev.get(ev.agentId);
            if (!a || a.tools.some((t) => t.ts === ev.ts && t.tool === ev.tool))
              return prev;
            const next = new Map(prev);
            next.set(ev.agentId, {
              ...a,
              tools: [
                ...a.tools,
                { tool: ev.tool, argsPreview: ev.argsPreview, ts: ev.ts },
              ],
            });
            return next;
          });
          break;
        case "delegation_finished":
          setAgents((prev) => {
            const a = prev.get(ev.agentId);
            if (a?.finishedAt === ev.ts) return prev;
            const next = new Map(prev);
            next.set(ev.agentId, {
              agentId: ev.agentId,
              task: a?.task ?? "",
              tools: a?.tools ?? [],
              state: ev.status === "ok" ? "done" : ev.status,
              summary: ev.summary,
              sources: ev.sources,
              data: ev.data,
              durationMs: ev.durationMs,
              startedAt: a?.startedAt ?? ev.ts - ev.durationMs,
              finishedAt: ev.ts,
            });
            return next;
          });
          break;
        case "assistant_message":
          setMessages((prev) =>
            prev.some((m) => m.role === "assistant" && m.ts === ev.ts)
              ? prev
              : [...prev, { role: "assistant", text: ev.text, ts: ev.ts }],
          );
          break;
        case "run_finished":
          setOrb((o) => (o === "thinking" ? "idle" : o));
          break;
        default:
          break;
      }
    };

    const connect = () => {
      ws = new WebSocket(`${socketBase()}/ws?sessionId=${sessionId}`);
      ws.onopen = () => {
        attempts = 0;
        setConnection("open");
      };
      ws.onmessage = (m) => handle(JSON.parse(m.data as string) as SessionEvent);
      ws.onclose = () => {
        if (closed) return;
        setConnection("reconnecting");
        retry = setTimeout(connect, Math.min(8000, 500 * 2 ** attempts++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [sessionId]);

  // ── /voice socket ────────────────────────────────────────────
  // Reconnects like /ws. A deploy or the gateway's idle timeout closes it, and
  // a closed socket used to leave the mic button doing nothing.
  useEffect(() => {
    if (!sessionId) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let closed = false;

    const handle = (m: MessageEvent) => {
      if (m.data instanceof ArrayBuffer) {
        audioChunks.current.push(new Uint8Array(m.data));
        return;
      }
      const msg = JSON.parse(m.data as string) as {
        type: string;
        text?: string;
        mime?: string;
        stt?: boolean;
        message?: string;
      };
      switch (msg.type) {
        case "ready":
          attempts = 0;
          setVoice(msg.stt ? "ready" : "off");
          break;
        case "transcript":
          awaitingTranscript.current = false;
          // solidify the "listening…" placeholder into the final transcript
          setMessages((prev) => {
            const next = prev.filter((b) => !b.partial);
            if (msg.text?.trim())
              next.push({ role: "user", text: msg.text });
            return next;
          });
          setOrb("thinking");
          break;
        case "tts_start":
          audioChunks.current = [];
          setOrb("speaking");
          break;
        case "tts_end": {
          const blob = new Blob(audioChunks.current as BlobPart[], {
            type: "audio/mpeg",
          });
          audioChunks.current = [];
          const audio = new Audio(URL.createObjectURL(blob));
          player.current = audio;
          audio.onended = () => setOrb("idle");
          void audio.play().catch(() => setOrb("idle"));
          break;
        }
        case "error":
          awaitingTranscript.current = false;
          // failed/empty STT: drop the "…" placeholder instead of stranding it
          setMessages((prev) => prev.filter((b) => !b.partial));
          setVoiceIssue(voiceIssueFor(msg.message));
          setOrb("idle");
          break;
        default:
          break;
      }
    };

    const connect = () => {
      const socket = new WebSocket(`${socketBase()}/voice?sessionId=${sessionId}`);
      ws = socket;
      socket.binaryType = "arraybuffer";
      voiceWs.current = socket;
      socket.onmessage = handle;
      socket.onclose = () => {
        // A socket replaced by a new session (or React's dev remount) closes late; ignore it.
        if (closed || voiceWs.current !== socket) return;
        voiceWs.current = null;
        setVoice("connecting");
        if (recorder.current || awaitingTranscript.current) {
          // The recording went down with the socket: no transcript will arrive.
          recorder.current?.stop();
          awaitingTranscript.current = false;
          setMessages((prev) => prev.filter((b) => !b.partial));
          setVoiceIssue(VOICE_DROPPED);
          setOrb((o) => (o === "listening" || o === "thinking" ? "idle" : o));
        }
        // Starts at 1 s: the gateway allows 12 socket connections a minute.
        retry = setTimeout(connect, Math.min(8000, 1000 * 2 ** attempts++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      voiceWs.current = null;
      ws?.close();
    };
  }, [sessionId]);

  // ── actions ──────────────────────────────────────────────────
  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setMessages((prev) => [...prev, { role: "user", text }]);
      setOrb("thinking");
      void fetch(`${ORCH_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(response.status === 429 ? "Roam is busy. Please wait a moment and try again." : "Your message could not be completed. Please try again.");
        })
        .catch((error: unknown) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: error instanceof Error && error.message.startsWith("Roam is busy") ? error.message : "I couldn't complete that request. Please try again in a moment.",
            },
          ]);
        })
        .finally(() => setOrb((o) => (o === "thinking" ? "idle" : o)));
    },
    [sessionId],
  );

  const startListening = useCallback(async () => {
    const ws = voiceWs.current;
    setVoiceIssue("");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setVoiceIssue("Voice is reconnecting. Try again in a moment, or type your message below.");
      return;
    }
    // One recorder at a time — a second start while recording would interleave
    // two webm streams into one server buffer and corrupt the audio.
    if (recorder.current) return;
    player.current?.pause(); // barge-in: stop playback, tell server to stop streaming
    ws.send(JSON.stringify({ type: "cancel" }));
    ws.send(JSON.stringify({ type: "audio_reset" }));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Chrome/Firefox record webm/opus; Safari records mp4 — tell the server which.
    const mime = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    // Chunks are read asynchronously; one queue keeps them in order and makes
    // audio_end wait for the last chunk instead of overtaking it.
    let sending = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      sending = sending
        .then(() => e.data.arrayBuffer())
        .then((buf) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        });
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      void sending.then(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          setMessages((prev) => prev.filter((b) => !b.partial));
          setVoiceIssue(VOICE_DROPPED);
          setOrb((o) => (o === "thinking" ? "idle" : o));
          return;
        }
        awaitingTranscript.current = true;
        ws.send(JSON.stringify({ type: "audio_end", mime }));
      });
    };
    recorder.current = rec;
    rec.start(250);
    setOrb("listening");
    setMessages((prev) => [
      ...prev.filter((b) => !b.partial),
      { role: "user", text: "…", partial: true },
    ]);
  }, []);

  const stopListening = useCallback(() => {
    recorder.current?.stop(); // onstop clears recorder.current and sends audio_end
    setOrb("thinking");
  }, []);

  const newTrip = useCallback(() => {
    recorder.current?.stop();
    player.current?.pause();
    awaitingTranscript.current = false;
    setVoiceIssue("");
    writeStored(null);
    setMessages([]);
    setAgents(new Map());
    setOrb("idle");
    setConnection("connecting");
    setSessionId(newSessionId());
  }, []);

  const stopSpeaking = useCallback(() => {
    player.current?.pause();
    voiceWs.current?.send(JSON.stringify({ type: "cancel" }));
    setOrb("idle");
  }, []);

  return {
    sessionId,
    messages,
    agents,
    orb,
    runningCount,
    voiceAvailable: voice === "ready",
    voice,
    voiceIssue,
    connection,
    sendText,
    newTrip,
    startListening,
    stopListening,
    stopSpeaking,
  };
}
