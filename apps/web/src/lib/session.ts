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
  [/still working/, "I'm still working on your last request. Ask again once I've answered."],
  [/rate limited|in progress/, "Give me a few seconds between voice messages, then try again."],
  [/live voice unavailable/, "Hands-free voice isn't available right now. Type your message below."],
  [/stt_failed/, "I couldn't transcribe that. Try again, or type your message below."],
  [/run_failed/, "I couldn't complete that request. Please try again in a moment."],
];
const VOICE_DROPPED = "The voice connection dropped. Try again in a moment.";
const LIVE_ENDED: Record<string, string> = {
  idle: "Voice paused after two quiet minutes. Tap the mic to keep talking.",
  limit: "Voice paused after 15 minutes. Tap the mic to keep talking.",
  error: "Voice stopped unexpectedly. Tap the mic to try again, or type your message below.",
};

/** 16-bit little-endian PCM to the -1..1 floats Web Audio plays. */
export function pcmToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Barge-in needs two words, so a cough or the speaker's own echo doesn't cut Roam off. */
export const isBargeIn = (heard: string) => heard.trim().split(/\s+/).filter(Boolean).length >= 2;
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
  /** The server can run a hands-free conversation (streaming speech-to-text). */
  liveAvailable: boolean;
  /** A hands-free conversation is on: the mic stays open between turns. */
  live: boolean;
  voice: VoiceStatus;
  /** The last voice problem, in words for the customer; cleared on the next attempt. */
  voiceIssue: string;
  connection: Connection;
  sendText: (text: string) => void;
  newTrip: () => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  startConversation: () => Promise<void>;
  stopConversation: () => void;
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
  const [live, setLive] = useState(false);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const liveRef = useRef(false);
  const startingLive = useRef(false);
  const capture = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  // Streaming speech: PCM clips are scheduled back to back as they arrive.
  const playback = useRef<{ ctx: AudioContext; next: number; sources: Set<AudioBufferSourceNode> } | null>(null);
  const pcmRate = useRef<number | null>(null);
  const pcmCarry = useRef<Uint8Array | null>(null);
  const restingOrb = () => (liveRef.current ? "listening" : "idle");

  /** Created on a click, so the browser lets it play sound later. */
  const ensurePlayback = () => {
    if (!playback.current) playback.current = { ctx: new AudioContext(), next: 0, sources: new Set() };
    void playback.current.ctx.resume();
  };

  const playPcm = (data: ArrayBuffer) => {
    const p = playback.current;
    const rate = pcmRate.current;
    if (!p || !rate) return;
    // A frame can split a 16-bit sample; carry the odd byte into the next one.
    let bytes = new Uint8Array(data);
    if (pcmCarry.current) {
      const joined = new Uint8Array(pcmCarry.current.length + bytes.length);
      joined.set(pcmCarry.current);
      joined.set(bytes, pcmCarry.current.length);
      bytes = joined;
      pcmCarry.current = null;
    }
    if (bytes.length % 2) {
      pcmCarry.current = bytes.slice(-1);
      bytes = bytes.subarray(0, -1);
    }
    if (!bytes.length) return;
    const samples = pcmToFloat(bytes);
    const buffer = p.ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = p.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(p.ctx.destination);
    const start = Math.max(p.ctx.currentTime + 0.05, p.next);
    source.start(start);
    p.next = start + buffer.duration;
    p.sources.add(source);
    source.onended = () => {
      p.sources.delete(source);
      if (!p.sources.size) setOrb((o) => (o === "speaking" ? restingOrb() : o));
    };
  };

  const stopPlayback = () => {
    player.current?.pause();
    const p = playback.current;
    if (p) {
      for (const source of p.sources) {
        source.onended = null;
        source.stop();
      }
      p.sources.clear();
      p.next = 0;
    }
    pcmCarry.current = null;
  };

  const isPlaying = () =>
    Boolean(playback.current?.sources.size) || Boolean(player.current && !player.current.paused);

  const endCapture = () => {
    const c = capture.current;
    capture.current = null;
    c?.stream.getTracks().forEach((t) => t.stop());
    void c?.ctx.close();
    liveRef.current = false;
    setLive(false);
  };

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
          setOrb((o) => (o === "thinking" ? restingOrb() : o));
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
        if (pcmRate.current) playPcm(m.data);
        else audioChunks.current.push(new Uint8Array(m.data));
        return;
      }
      const msg = JSON.parse(m.data as string) as {
        type: string;
        text?: string;
        mime?: string;
        stt?: boolean;
        live?: boolean;
        reason?: string;
        message?: string;
      };
      switch (msg.type) {
        case "ready":
          attempts = 0;
          setVoice(msg.stt ? "ready" : "off");
          setLiveAvailable(Boolean(msg.live));
          break;
        case "live_stopped":
          if (!liveRef.current) break;
          endCapture();
          setMessages((prev) => prev.filter((b) => !b.partial));
          setOrb((o) => (o === "listening" ? "idle" : o));
          if (msg.reason && LIVE_ENDED[msg.reason]) setVoiceIssue(LIVE_ENDED[msg.reason]!);
          break;
        case "transcript_partial":
          if (!msg.text) break;
          // Talking over Roam stops its speech, like interrupting a person.
          if (isPlaying() && isBargeIn(msg.text)) {
            stopPlayback();
            voiceWs.current?.send(JSON.stringify({ type: "cancel" }));
            setOrb("listening");
          }
          setMessages((prev) => [
            ...prev.filter((b) => !b.partial),
            { role: "user", text: msg.text!, partial: true },
          ]);
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
        case "tts_start": {
          audioChunks.current = [];
          // "audio/pcm;rate=24000" streams as it arrives; mp3 waits for tts_end.
          const rate = /^audio\/pcm;rate=(\d+)/.exec(msg.mime ?? "")?.[1];
          pcmRate.current = rate ? Number(rate) : null;
          pcmCarry.current = null;
          setOrb("speaking");
          break;
        }
        case "tts_end": {
          if (pcmRate.current) {
            // Nothing arrived (or it was all cancelled): don't stay "speaking".
            if (!playback.current?.sources.size) setOrb((o) => (o === "speaking" ? restingOrb() : o));
            break;
          }
          const blob = new Blob(audioChunks.current as BlobPart[], {
            type: "audio/mpeg",
          });
          audioChunks.current = [];
          const audio = new Audio(URL.createObjectURL(blob));
          player.current = audio;
          audio.onended = () => setOrb(restingOrb());
          void audio.play().catch(() => setOrb(restingOrb()));
          break;
        }
        case "error":
          awaitingTranscript.current = false;
          // failed/empty STT: drop the "…" placeholder instead of stranding it
          setMessages((prev) => prev.filter((b) => !b.partial));
          setVoiceIssue(voiceIssueFor(msg.message));
          setOrb((o) => (liveRef.current && o === "speaking" ? o : restingOrb()));
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
        if (liveRef.current) {
          // The server ends the conversation with the socket; say so.
          endCapture();
          setMessages((prev) => prev.filter((b) => !b.partial));
          setVoiceIssue(VOICE_DROPPED);
          setOrb((o) => (o === "listening" ? "idle" : o));
        }
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
    ensurePlayback();
    stopPlayback(); // barge-in: stop playback, tell server to stop streaming
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

  /** Hands-free: the mic streams until the user ends it; Deepgram finds each turn's end. */
  const startConversation = useCallback(async () => {
    const ws = voiceWs.current;
    setVoiceIssue("");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setVoiceIssue("Voice is reconnecting. Try again in a moment, or type your message below.");
      return;
    }
    // A second click while the mic permission prompt is open must not start two captures.
    if (capture.current || startingLive.current) return;
    startingLive.current = true;
    ensurePlayback();
    let stream: MediaStream;
    const ctx = new AudioContext();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation keeps Roam's own voice out of the mic.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      void ctx.close();
      startingLive.current = false;
      throw error;
    }
    try {
      await ctx.audioWorklet.addModule("/pcm-capture.js");
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      startingLive.current = false;
      throw error;
    }
    startingLive.current = false;
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const socket = voiceWs.current;
      if (socket?.readyState === WebSocket.OPEN && liveRef.current) socket.send(e.data);
    };
    // A silent output keeps the worklet running in every browser.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
    ws.send(JSON.stringify({ type: "live_start" }));
    capture.current = { stream, ctx };
    liveRef.current = true;
    setLive(true);
    setOrb((o) => (o === "idle" ? "listening" : o));
  }, []);

  const stopConversation = useCallback(() => {
    voiceWs.current?.send(JSON.stringify({ type: "live_stop" }));
    endCapture();
    setMessages((prev) => prev.filter((b) => !b.partial));
    setOrb((o) => (o === "listening" ? "idle" : o));
  }, []);

  const newTrip = useCallback(() => {
    if (liveRef.current) voiceWs.current?.send(JSON.stringify({ type: "live_stop" }));
    endCapture();
    recorder.current?.stop();
    stopPlayback();
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
    stopPlayback();
    voiceWs.current?.send(JSON.stringify({ type: "cancel" }));
    setOrb(restingOrb());
  }, []);

  return {
    sessionId,
    messages,
    agents,
    orb,
    runningCount,
    voiceAvailable: voice === "ready",
    liveAvailable: voice === "ready" && liveAvailable,
    live,
    voice,
    voiceIssue,
    connection,
    sendText,
    newTrip,
    startListening,
    stopListening,
    startConversation,
    stopConversation,
    stopSpeaking,
  };
}
