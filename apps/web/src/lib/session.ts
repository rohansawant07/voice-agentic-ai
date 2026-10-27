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
}

export interface AgentActivity {
  agentId: string;
  state: "running" | "done" | "failed" | "needs_input";
  task: string;
  tools: { tool: string; argsPreview: Record<string, unknown> }[];
  summary?: string;
  data?: unknown;
  durationMs?: number;
}

export interface SessionState {
  sessionId: string;
  messages: ChatMessage[];
  agents: Map<string, AgentActivity>;
  orb: OrbState;
  runningCount: number;
  voiceAvailable: boolean;
  sendText: (text: string) => void;
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
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    setSessionId(
      "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}`,
    );
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentActivity>>(new Map());
  const [orb, setOrb] = useState<OrbState>("idle");
  const [runningCount, setRunningCount] = useState(0);
  const [voiceAvailable, setVoiceAvailable] = useState(false);

  const voiceWs = useRef<WebSocket | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Uint8Array[]>([]);
  const player = useRef<HTMLAudioElement | null>(null);

  // ── /ws activity feed ────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const ws = new WebSocket(`${socketBase()}/ws?sessionId=${sessionId}`);
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data as string) as SessionEvent;
      switch (ev.type) {
        case "delegation_started":
          setAgents((prev) => {
            const next = new Map(prev);
            next.set(ev.agentId, {
              agentId: ev.agentId,
              state: "running",
              task: ev.task,
              tools: [],
            });
            return next;
          });
          setRunningCount((n) => n + 1);
          break;
        case "tool_called":
          setAgents((prev) => {
            const next = new Map(prev);
            const a = next.get(ev.agentId);
            if (a)
              next.set(ev.agentId, {
                ...a,
                tools: [...a.tools, { tool: ev.tool, argsPreview: ev.argsPreview }],
              });
            return next;
          });
          break;
        case "delegation_finished":
          setAgents((prev) => {
            const next = new Map(prev);
            const a = next.get(ev.agentId);
            next.set(ev.agentId, {
              agentId: ev.agentId,
              task: a?.task ?? "",
              tools: a?.tools ?? [],
              state: ev.status === "ok" ? "done" : ev.status,
              summary: ev.summary,
              data: ev.data,
              durationMs: ev.durationMs,
            });
            return next;
          });
          setRunningCount((n) => Math.max(0, n - 1));
          break;
        case "assistant_message":
          setMessages((prev) => [...prev, { role: "assistant", text: ev.text }]);
          break;
        case "run_finished":
          setOrb((o) => (o === "thinking" ? "idle" : o));
          break;
        default:
          break;
      }
    };
    return () => ws.close();
  }, [sessionId]);

  // ── /voice socket ────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const ws = new WebSocket(`${socketBase()}/voice?sessionId=${sessionId}`);
    ws.binaryType = "arraybuffer";
    voiceWs.current = ws;
    ws.onmessage = (m) => {
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
          setVoiceAvailable(Boolean(msg.stt));
          break;
        case "transcript":
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
          // failed/empty STT: drop the "…" placeholder instead of stranding it
          setMessages((prev) => prev.filter((b) => !b.partial));
          setOrb("idle");
          break;
        default:
          break;
      }
    };
    return () => {
      voiceWs.current = null;
      ws.close();
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
    rec.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN)
        void e.data.arrayBuffer().then((buf) => ws.send(buf));
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      ws.send(JSON.stringify({ type: "audio_end", mime }));
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
    voiceAvailable,
    sendText,
    startListening,
    stopListening,
    stopSpeaking,
  };
}
