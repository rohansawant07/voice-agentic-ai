"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession, type AgentActivity } from "../lib/session";
import { ActivityTimeline, ResultsCanvas } from "../components/canvas";
import { Icon } from "../components/icon";

const SUGGESTIONS = [
  {
    icon: "map" as const,
    title: "A weekend in the mountains",
    detail: "Shenandoah, slow mornings & scenic trails",
    prompt:
      "Plan a 3-day weekend in Shenandoah Valley for two, with scenic trails and Airbnb search links.",
  },
  {
    icon: "sun" as const,
    title: "Somewhere a little warmer",
    detail: "San Juan, good food & ocean air",
    prompt: "Plan a long weekend in San Juan under $1500 for two, from JFK.",
  },
  {
    icon: "compass" as const,
    title: "Take the scenic route",
    detail: "Three days exploring Savannah",
    prompt:
      "Build me a 3-day Savannah itinerary with local food and leisurely walks.",
  },
];

function followUps(agents: Map<string, AgentActivity>): string[] {
  const has = (id: string, key: "options" | "days") => {
    const a = agents.get(id);
    const data = a?.data as Record<string, unknown[] | undefined> | undefined;
    return a?.state === "done" && Boolean(data?.[key]?.length);
  };
  const ideas: string[] = [];
  if (has("flight-agent", "options")) ideas.push("Only show nonstop flights");
  if (has("hotel-agent", "options")) ideas.push("Find a cheaper place to stay");
  if (has("itinerary-agent", "days")) ideas.push("Add a day trip outside the city");
  if (ideas.length > 0 && !agents.has("budget-agent"))
    ideas.push("Break down the full trip budget");
  // Nothing usable yet usually means Roam asked a question; let the person answer.
  return ideas.slice(0, 3);
}

export default function SessionPage() {
  const s = useSession();
  const [tab, setTab] = useState<"results" | "agents">("results");
  const [mobilePane, setMobilePane] = useState<"conversation" | "board">(
    "conversation",
  );
  const [draft, setDraft] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy =
    s.orb === "thinking" || s.runningCount > 0 || s.orb === "listening";
  const hasMessages = s.messages.length > 0;
  const lastIsAssistant = s.messages.at(-1)?.role === "assistant";
  const ideas = useMemo(() => followUps(s.agents), [s.agents]);

  useEffect(() => {
    if (s.messages.length > 0)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [s.messages]);

  useEffect(() => {
    const isInteractive = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          "input, textarea, select, button, a, [contenteditable='true']",
        ),
      );
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape" && s.orb === "speaking") s.stopSpeaking();
      if (
        event.code !== "Space" ||
        event.repeat ||
        isInteractive(event.target) ||
        !s.voiceAvailable ||
        busy
      )
        return;
      event.preventDefault();
      setVoiceError("");
      void s
        .startListening()
        .catch(() =>
          setVoiceError(
            "Microphone access is unavailable. Check your browser permissions, or type your message below.",
          ),
        );
    };
    const up = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !isInteractive(event.target) &&
        s.orb === "listening"
      ) {
        event.preventDefault();
        s.stopListening();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [s, busy]);

  const beginVoice = async () => {
    setVoiceError("");
    try {
      await s.startListening();
    } catch {
      setVoiceError(
        "Microphone access is unavailable. Check your browser permissions, or type your message below.",
      );
    }
  };

  const send = (text: string) => {
    if (!text.trim() || busy || !s.sessionId) return;
    s.sendText(text.trim());
    setDraft("");
  };
  const choose = (text: string) => {
    setDraft(text);
    setMobilePane("conversation");
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const voiceLabel =
    s.orb === "listening"
      ? "Listening. Tap to finish"
      : s.orb === "speaking"
        ? "Speaking. Tap to stop"
        : busy
          ? "Putting your trip together…"
          : s.voiceAvailable
            ? "Prefer to talk? I'm listening."
            : "Type a message to start planning.";

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Roam home">
          <span className="brand-mark">
            <Icon name="compass" size={25} />
          </span>
          roam<span className="brand-dot">.</span>
        </a>
        <span className="brand-description">
          A good trip starts with a conversation.
        </span>
        <span className="header-tag">
          <Icon name="pin" size={14} /> US & territories
        </span>
        {hasMessages && (
          <button
            className="new-trip"
            onClick={() => {
              s.newTrip();
              setDraft("");
              setVoiceError("");
              setTab("results");
              setMobilePane("conversation");
            }}
            disabled={s.runningCount > 0 || s.orb === "thinking"}
          >
            <Icon name="plus" size={16} /> New trip
          </button>
        )}
      </header>
      {s.connection === "reconnecting" && (
        <div className="connection-banner" role="status">
          Reconnecting to Roam. Your trip is saved and will reappear when the
          connection returns.
        </div>
      )}
      <div className="mobile-nav" aria-label="Workspace view">
        <button
          aria-pressed={mobilePane === "conversation"}
          onClick={() => setMobilePane("conversation")}
        >
          Conversation
        </button>
        <button
          aria-pressed={mobilePane === "board"}
          onClick={() => setMobilePane("board")}
        >
          Trip board {s.agents.size > 0 && <span>{s.agents.size}</span>}
        </button>
      </div>
      <main className={`split show-${mobilePane}`}>
        <section className="pane-conversation" aria-label="Conversation">
          <div className="conversation-heading">
            <span className="assistant-mark">
              <Icon name="sparkle" size={17} />
            </span>
            <div>
              <strong>Your travel companion</strong>
              <span>A little inspiration. A plan that fits.</span>
            </div>
            <span
              className={`connection-dot ${busy ? "working" : ""} ${s.connection !== "open" ? "offline" : ""}`}
              role="img"
              aria-label={
                s.connection !== "open" ? "Connecting" : busy ? "Planning" : "Ready"
              }
            />
          </div>
          <div
            className={`scroll conversation-scroll ${hasMessages ? "has-messages" : ""}`}
            ref={scrollRef}
            role="log"
            aria-label="Travel conversation"
            aria-live="polite"
          >
            {!hasMessages && (
              <div className="welcome">
                <div className="welcome-symbol">
                  <Icon name="compass" size={32} />
                </div>
                <h1>
                  Less searching.
                  <br />
                  More getting lost.
                </h1>
                <p>
                  Tell me what a great getaway looks like.
                  <br className="desktop-break" /> We’ll figure out the way
                  there, together.
                </p>
                <div className="suggestion-label">A few places to start</div>
                <div className="suggestion-list">
                  {SUGGESTIONS.map((item) => (
                    <button
                      key={item.title}
                      className="suggestion"
                      onClick={() => choose(item.prompt)}
                    >
                      <span className="suggestion-icon">
                        <Icon name={item.icon} />
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <Icon name="arrow" size={17} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {s.messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <span className="message-author">
                  {m.role === "assistant" ? "Roam" : "You"}
                </span>
                <div
                  className={`bubble ${m.role}${m.partial ? " partial" : ""}`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {s.orb === "thinking" && (
              <div className="thinking" role="status">
                <span />
                <span />
                <span />
                {s.runningCount > 0
                  ? `Researching with ${s.runningCount} specialist${s.runningCount === 1 ? "" : "s"}`
                  : "Finding your kind of getaway"}
              </div>
            )}
            {lastIsAssistant && !busy && (
              <div className="follow-ups" aria-label="Suggested replies">
                {ideas.map((idea) => (
                  <button key={idea} onClick={() => choose(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-area">
            <div className="voice-row">
              <button
                className={`voice-button ${s.orb}`}
                disabled={!s.voiceAvailable || s.orb === "thinking"}
                aria-label={
                  s.orb === "listening"
                    ? "Finish recording"
                    : s.orb === "speaking"
                      ? "Stop speaking"
                      : "Start voice input"
                }
                aria-pressed={s.orb === "listening"}
                onClick={() =>
                  s.orb === "listening"
                    ? s.stopListening()
                    : s.orb === "speaking"
                      ? s.stopSpeaking()
                      : void beginVoice()
                }
              >
                <Icon
                  name={
                    s.orb === "listening" || s.orb === "speaking"
                      ? "wave"
                      : "mic"
                  }
                  size={18}
                />
              </button>
              <span aria-live="polite">{voiceLabel}</span>
            </div>
            {voiceError && (
              <p className="voice-error" role="alert">
                {voiceError}
              </p>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                placeholder="Where would you like to go?"
                aria-label="Message Roam"
                rows={2}
              />
              <div className="composer-bottom">
                <span>Type a thought. Make it a trip.</span>
                <button
                  className="send-button"
                  type="submit"
                  disabled={!draft.trim() || busy || !s.sessionId}
                  aria-label="Send message"
                >
                  <Icon name="send" size={19} />
                </button>
              </div>
            </form>
            <p className="composer-note">
              Made for exploring. Always verify prices before booking.
            </p>
          </div>
        </section>
        <section className="pane-canvas" aria-label="Trip board">
          <nav className="canvas-tabs" aria-label="Trip board views">
            <h2>Trip board</h2>
            <button
              aria-pressed={tab === "results"}
              className={tab === "results" ? "active" : ""}
              onClick={() => setTab("results")}
            >
              Overview
            </button>
            <button
              aria-pressed={tab === "agents"}
              className={tab === "agents" ? "active" : ""}
              onClick={() => setTab("agents")}
            >
              Planning activity{" "}
              {s.runningCount > 0 && (
                <span className="activity-count">{s.runningCount}</span>
              )}
            </button>
            <span className="board-status">
              {s.runningCount > 0
                ? "Taking shape…"
                : s.agents.size > 0
                  ? "Your discoveries"
                  : "Room for possibility"}
            </span>
          </nav>
          {tab === "results" ? (
            <ResultsCanvas
              key={s.sessionId}
              sessionId={s.sessionId}
              agents={s.agents}
              messages={s.messages}
              onInspiration={choose}
            />
          ) : (
            <ActivityTimeline agents={s.agents} />
          )}
        </section>
      </main>
    </div>
  );
}
