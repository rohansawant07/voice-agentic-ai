"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "../lib/session";
import { AgentsGraph, ResultsCanvas } from "../components/canvas";

const SUGGESTIONS = [
  "Plan a long weekend in San Juan under $1500 for two, from JFK",
  "Where's warm in February? We like beaches and food",
  "Build me a 3-day Savannah itinerary",
];

export default function SessionPage() {
  const s = useSession();
  const [tab, setTab] = useState<"results" | "agents">("results");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // auto-scroll transcript; auto-flip to results when first data lands
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [s.messages]);

  // keyboard: Space = push-to-talk, Esc = stop speaking (DESIGN §5.3)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.repeat) return; // held Space auto-repeats keydown
      if (e.code === "Space" && s.voiceAvailable && s.orb !== "listening") {
        e.preventDefault();
        void s.startListening();
      }
      if (e.code === "Escape") s.stopSpeaking();
    };
    const up = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space" && s.orb === "listening") {
        e.preventDefault();
        s.stopListening();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [s]);

  const orbLabel =
    s.orb === "listening"
      ? "listening…"
      : s.orb === "speaking"
        ? "speaking…"
        : s.runningCount > 0
          ? `${s.runningCount} agent${s.runningCount > 1 ? "s" : ""} working…`
          : s.orb === "thinking"
            ? "thinking…"
            : s.voiceAvailable
              ? "tap or hold Space"
              : "voice off — type below";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    s.sendText(draft);
    setDraft("");
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <span style={{ color: "var(--accent)" }}>◉</span> Roam
        </span>
        <span className="session-label">
          {s.sessionId ? `#${s.sessionId.slice(0, 6)}` : ""}
          {s.runningCount > 0 ? " · ⏱ live" : ""}
        </span>
      </header>

      <main className="split">
        <section className="pane-conversation" aria-label="Conversation">
          <div className="scroll" ref={scrollRef}>
            {s.messages.length === 0 && (
              <>
                <div className="bubble assistant">
                  <span className="glyph">◉</span>
                  Hi, I&apos;m your travel concierge for the US and its
                  territories. Where are we dreaming of?
                </div>
                <div className="chip-row">
                  {SUGGESTIONS.map((t) => (
                    <button key={t} className="chip" onClick={() => s.sendText(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
            {s.messages.map((m, i) => (
              <div
                key={i}
                className={`bubble ${m.role}${m.partial ? " partial" : ""}`}
              >
                {m.role === "assistant" && <span className="glyph">◉</span>}
                {m.text}
              </div>
            ))}
          </div>
        </section>

        <section className="pane-canvas" aria-label="Canvas">
          <nav className="canvas-tabs">
            <button
              className={tab === "results" ? "active" : ""}
              onClick={() => setTab("results")}
            >
              Results
            </button>
            <button
              className={tab === "agents" ? "active" : ""}
              onClick={() => setTab("agents")}
            >
              Agents{s.runningCount > 0 ? ` · ${s.runningCount} live` : ""}
            </button>
          </nav>
          {tab === "results" ? (
            <ResultsCanvas
              agents={s.agents}
              onSelectionChange={(kind, id) =>
                // selection is confirmed to the orchestrator on the next turn
                console.log("selected", kind, id)
              }
            />
          ) : (
            <AgentsGraph agents={s.agents} />
          )}
        </section>
      </main>

      <footer className="bottombar">
        <form onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="type a message…"
            aria-label="Message"
          />
        </form>
        <div className="orb-wrap">
          <button
            className={`orb ${s.voiceAvailable ? s.orb : "disabled"}`}
            aria-label={s.voiceAvailable ? "toggle voice input" : "voice disabled"}
            disabled={!s.voiceAvailable}
            onClick={() =>
              s.orb === "listening" ? s.stopListening() : void s.startListening()
            }
          />
          <span className="orb-status" aria-live="polite">
            {orbLabel}
          </span>
        </div>
      </footer>
    </div>
  );
}
