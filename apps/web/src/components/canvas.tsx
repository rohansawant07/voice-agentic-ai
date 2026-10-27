"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import type { AgentActivity, ChatMessage } from "../lib/session";
import {
  carTags,
  deriveTrip,
  describeTool,
  flightTags,
  hotelTags,
  pickedTotal,
  planText,
  usd,
  type Selection,
  type Trip,
} from "../lib/trip";
import {
  BookingCard,
  BudgetMeter,
  CarRow,
  FlightRow,
  HotelCard,
  Itinerary,
} from "./cards";

export const AGENTS: Record<string, { label: string; icon: IconName }> = {
  "flight-agent": { label: "Flights", icon: "plane" },
  "hotel-agent": { label: "Places to stay", icon: "bed" },
  "car-rental-agent": { label: "Rental cars", icon: "car" },
  "itinerary-agent": { label: "Itinerary", icon: "route" },
  "budget-agent": { label: "Budget", icon: "wallet" },
  "support-agent": { label: "Bookings", icon: "ticket" },
};

const agentMeta = (id: string) =>
  AGENTS[id] ?? {
    label: id.replace(/-agent$/, "").replace(/-/g, " "),
    icon: "sparkle" as IconName,
  };

function latestStep(agent: AgentActivity) {
  const last = agent.tools.at(-1);
  return last ? describeTool(last.tool, last.argsPreview) : "Getting started";
}

function Section({
  id,
  agent,
  count,
  provenance,
  skeleton,
  children,
}: {
  id: string;
  agent: AgentActivity;
  count?: string;
  provenance?: string;
  skeleton: "rows" | "cards" | "panel";
  children: ReactNode;
}) {
  const meta = agentMeta(agent.agentId);
  const running = agent.state === "running";
  return (
    <section className="section" id={id} aria-busy={running}>
      <header className="section-header">
        <span className="section-icon">
          <Icon name={meta.icon} size={18} />
        </span>
        <div className="section-title">
          <h3>{meta.label}</h3>
          <span>
            {running
              ? latestStep(agent)
              : agent.state === "done"
                ? [count, provenance].filter(Boolean).join(". ")
                : agent.state === "needs_input"
                  ? "Needs a detail from you"
                  : "Couldn't finish"}
          </span>
        </div>
        <span className={`status-chip ${agent.state}`}>
          {running && <span className="spinner" aria-hidden="true" />}
          {running
            ? "Searching"
            : agent.state === "done"
              ? agent.durationMs != null
                ? `${(agent.durationMs / 1000).toFixed(1)}s`
                : "Done"
              : agent.state === "needs_input"
                ? "Needs input"
                : "Failed"}
        </span>
      </header>
      {agent.state === "failed" || agent.state === "needs_input" ? (
        <div className="failed-note" role="status">
          {agent.summary ?? "This search didn't finish. Ask Roam to try again."}
        </div>
      ) : running && agent.data == null ? (
        <div className={`skeleton ${skeleton}`} aria-hidden="true">
          {Array.from({ length: skeleton === "panel" ? 1 : 3 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function TripSummary({
  trip,
  picks,
  slots,
  running,
}: {
  trip: Trip;
  picks: Selection;
  slots: { kind: keyof Selection; label: string; icon: IconName }[];
  running: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { lines, total } = pickedTotal(trip, picks);
  const cap = trip.budgetCap;
  const share = cap ? Math.min(100, (total / cap) * 100) : 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planText(trip, picks));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="trip-summary">
      <div className="trip-headline">
        <div>
          <h3>{trip.route ?? "Your trip"}</h3>
          <div className="trip-facts">
            {trip.dates && <span>{trip.dates}</span>}
            {trip.travelers && (
              <span>
                {trip.travelers} traveler{trip.travelers > 1 ? "s" : ""}
              </span>
            )}
            {running && <span className="live">Still researching</span>}
          </div>
        </div>
        <button className="ghost-button" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} size={16} />
          {copied ? "Copied" : "Copy plan"}
        </button>
      </div>
      {slots.length > 0 && (
        <>
          <ul className="pick-slots">
            {slots.map((slot) => {
              const line = lines.find((l) => l.kind === slot.kind);
              return (
                <li key={slot.kind} className={line ? "filled" : undefined}>
                  <Icon name={slot.icon} size={17} />
                  {line ? (
                    <>
                      <span>{line.label}</span>
                      <strong className="price">{usd(line.amount)}</strong>
                    </>
                  ) : (
                    <span>Choose {slot.label}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="trip-total">
            <div>
              <span>Estimated total</span>
              <strong className="price">{lines.length ? usd(total) : "—"}</strong>
            </div>
            {cap != null && (
              <div className="budget-track">
                <div
                  className={`budget-fill${total > cap ? " over" : ""}`}
                  style={{ width: `${share}%` }}
                />
                <span className="price">
                  {!lines.length
                    ? `Your budget: ${usd(cap)}`
                    : total > cap
                      ? `${usd(total - cap)} over your ${usd(cap)} budget`
                      : `${usd(cap - total)} left of your ${usd(cap)} budget`}
                </span>
              </div>
            )}
          </div>
        </>
      )}
      <p className="provenance">
        <Icon name="info" size={14} />
        {slots.length
          ? "Flights, stays and cars are sample prices from demo inventory. Nothing is booked or held until you confirm with Roam."
          : "Nothing is booked. Airbnb links open a live search; Roam hasn't verified those listings or prices."}
      </p>
    </div>
  );
}

const NO_PICKS: Selection = { flight: null, hotel: null, car: null };

/** Restores this session's picks and drops picks saved for older trips. */
function readPicks(sessionId: string): Selection {
  if (!sessionId) return NO_PICKS;
  try {
    const key = `roam.picks.${sessionId}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("roam.picks.") && k !== key) localStorage.removeItem(k);
    }
    const raw = localStorage.getItem(key);
    return raw ? { ...NO_PICKS, ...(JSON.parse(raw) as Selection) } : NO_PICKS;
  } catch {
    return NO_PICKS;
  }
}

/** Results tab — sections appear only when a specialist has activity. */
export function ResultsCanvas({
  sessionId,
  agents,
  messages,
  onInspiration,
}: {
  sessionId: string;
  agents: Map<string, AgentActivity>;
  messages: ChatMessage[];
  onInspiration: (prompt: string) => void;
}) {
  const [picks, setPicks] = useState<Selection>(() => readPicks(sessionId));
  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(`roam.picks.${sessionId}`, JSON.stringify(picks));
    } catch {
      // Storage unavailable: picks last for this page view only.
    }
  }, [sessionId, picks]);
  const trip = useMemo(() => deriveTrip(agents, messages), [agents, messages]);
  const pick = (kind: keyof Selection, id: string) =>
    setPicks((p) => ({ ...p, [kind]: p[kind] === id ? null : id }));

  const flight = agents.get("flight-agent");
  const hotel = agents.get("hotel-agent");
  const car = agents.get("car-rental-agent");
  const itinerary = agents.get("itinerary-agent");
  const budget = agents.get("budget-agent");
  const support = agents.get("support-agent");

  if (!flight && !hotel && !car && !itinerary && !budget && !support) {
    return (
      <div className="scroll inspiration-board">
        <div className="destination-hero">
          <div className="photo-label">
            <Icon name="compass" size={15} /> Go a little further
          </div>
          <div className="destination-copy">
            <span>Fresh air. A fresh perspective.</span>
            <h3>
              Find your
              <br />
              somewhere.
            </h3>
            <p>The best plans leave room for a little wonder.</p>
            <button
              onClick={() =>
                onInspiration(
                  "Help me plan a scenic mountain getaway in the US for two. Ask me about my dates and budget first.",
                )
              }
            >
              Plan a mountain escape <Icon name="arrow" size={17} />
            </button>
          </div>
          <a
            className="photo-credit"
            href="https://unsplash.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Photography from Unsplash"
          >
            Photo · Unsplash
          </a>
        </div>
        <div className="board-intro">
          <h3>A little spark for your next trip</h3>
          <p>Pick a direction. We’ll help with the details.</p>
        </div>
        <div className="inspiration-grid">
          <button
            className="inspiration-card coastal"
            onClick={() =>
              onInspiration(
                "I'd love a relaxing beach weekend in San Juan. Help me plan stays, food and a flexible itinerary.",
              )
            }
          >
            <span className="mini-landscape">
              <Icon name="sun" size={30} />
            </span>
            <span className="inspiration-content">
              <strong>Follow the sunshine</strong>
              <small>Salt air & slower days</small>
            </span>
            <Icon name="arrow" size={17} />
          </button>
          <button
            className="inspiration-card city"
            onClick={() =>
              onInspiration(
                "Plan a food-focused weekend in Savannah with walkable neighborhoods and interesting local stops.",
              )
            }
          >
            <span className="mini-landscape">
              <Icon name="map" size={28} />
            </span>
            <span className="inspiration-content">
              <strong>Wander a new city</strong>
              <small>Good food & unexpected turns</small>
            </span>
            <Icon name="arrow" size={17} />
          </button>
        </div>
        <div className="board-footnote">
          <Icon name="sparkle" size={18} />
          <p>
            Your stays, daily plans and budget will come together here as we
            talk.
          </p>
        </div>
      </div>
    );
  }

  const running = [...agents.values()].some((a) => a.state === "running");
  // Only offer a pick slot where there is demo inventory to choose from.
  const slots: { kind: keyof Selection; label: string; icon: IconName }[] = [];
  if (trip.flights?.options.length)
    slots.push({ kind: "flight", label: "a flight", icon: "plane" });
  if (trip.hotels?.options.length)
    slots.push({ kind: "hotel", label: "a place to stay", icon: "bed" });
  if (trip.cars?.options.length)
    slots.push({ kind: "car", label: "a car", icon: "car" });

  const fTags = flightTags(trip.flights?.options ?? []);
  const hTags = hotelTags(trip.hotels?.options ?? []);
  const cTags = carTags(trip.cars?.options ?? []);
  const plural = (n: number | undefined, word: string) =>
    n ? `${n} ${word}${n === 1 ? "" : "s"}` : undefined;

  const jump = [
    flight && { id: "trip-flights", label: "Flights", icon: "plane" as IconName },
    hotel && { id: "trip-stays", label: "Stays", icon: "bed" as IconName },
    car && { id: "trip-cars", label: "Cars", icon: "car" as IconName },
    itinerary && { id: "trip-days", label: "Itinerary", icon: "route" as IconName },
    budget && { id: "trip-budget", label: "Budget", icon: "wallet" as IconName },
    support && { id: "trip-bookings", label: "Bookings", icon: "ticket" as IconName },
  ].filter(Boolean) as { id: string; label: string; icon: IconName }[];

  return (
    <div className="scroll board-results">
      {(flight || hotel || car || itinerary) && (
        <TripSummary trip={trip} picks={picks} slots={slots} running={running} />
      )}
      {jump.length > 1 && (
        <nav className="jump-nav" aria-label="Trip sections">
          {jump.map((j) => (
            <a key={j.id} href={`#${j.id}`}>
              <Icon name={j.icon} size={15} />
              {j.label}
            </a>
          ))}
        </nav>
      )}
      {flight && (
        <Section
          id="trip-flights"
          agent={flight}
          skeleton="rows"
          count={plural(trip.flights?.options.length, "option")}
          provenance="Round-trip sample fares, per person"
        >
          <div className="option-list">
            {trip.flights?.options.map((f) => (
              <FlightRow
                key={f.id}
                flight={f}
                tags={fTags.get(f.id)}
                travelers={trip.travelers}
                selected={picks.flight === f.id}
                onSelect={() => pick("flight", f.id)}
              />
            ))}
          </div>
          {trip.flights?.notes && <p className="note-line">{trip.flights.notes}</p>}
        </Section>
      )}
      {hotel && (
        <Section
          id="trip-stays"
          agent={hotel}
          skeleton="cards"
          count={
            plural(trip.hotels?.options.length, "stay") ??
            plural(
              (trip.hotels?.vacationRentals?.length ?? 0) +
                (trip.hotels?.searchLinks?.length ?? 0),
              "Airbnb link",
            )
          }
          provenance={trip.hotels?.options.length ? "Sample nightly rates" : undefined}
        >
          {trip.hotels?.notes && <p className="note-line">{trip.hotels.notes}</p>}
          {trip.hotels?.options?.length ? (
            <div className="stay-grid">
              {trip.hotels.options.map((h) => (
                <HotelCard
                  key={h.id}
                  hotel={h}
                  tags={hTags.get(h.id)}
                  selected={picks.hotel === h.id}
                  onSelect={() => pick("hotel", h.id)}
                />
              ))}
            </div>
          ) : null}
          {trip.hotels?.vacationRentals?.length ? (
            <div className="link-grid">
              {trip.hotels.vacationRentals.map((rental) => (
                <a
                  className="link-card"
                  key={rental.id}
                  href={rental.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="tag quiet">Airbnb · verify availability</span>
                  <strong>{rental.name}</strong>
                  {rental.priceText && <span className="price">{rental.priceText}</span>}
                  {rental.priceDetail && <small>{rental.priceDetail}</small>}
                  <span className="link-cta">
                    View on Airbnb <Icon name="link" size={13} />
                  </span>
                </a>
              ))}
            </div>
          ) : null}
          {trip.hotels?.searchLinks?.length ? (
            <div className="link-grid">
              {trip.hotels.searchLinks.map((link) => (
                <a
                  className="link-card"
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <strong>Airbnb stays in {link.destination}</strong>
                  <small>
                    {trip.hotels?.rentalSearchStatus === "live_results"
                      ? "Check final dates, location, prices and fees on Airbnb."
                      : "A search link only. Listings and prices are not verified by Roam."}
                  </small>
                  <span className="link-cta">
                    Search on Airbnb <Icon name="link" size={13} />
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </Section>
      )}
      {car && (
        <Section
          id="trip-cars"
          agent={car}
          skeleton="rows"
          count={plural(trip.cars?.options.length, "option")}
          provenance="Sample rates for the rental period"
        >
          <div className="option-list">
            {trip.cars?.options.map((r) => (
              <CarRow
                key={r.id}
                rental={r}
                tags={cTags.get(r.id)}
                selected={picks.car === r.id}
                onSelect={() => pick("car", r.id)}
              />
            ))}
          </div>
          {trip.cars?.notes && <p className="note-line">{trip.cars.notes}</p>}
        </Section>
      )}
      {itinerary && (
        <Section
          id="trip-days"
          agent={itinerary}
          skeleton="panel"
          count={
            plural(trip.itinerary?.days?.length, "day") ??
            plural(trip.itinerary?.destinations?.length, "idea")
          }
          provenance={
            trip.itinerary?.sources?.some((s) => s.url.includes("wikivoyage.org"))
              ? "From community Wikivoyage listings; confirm hours"
              : undefined
          }
        >
          {trip.itinerary && <Itinerary data={trip.itinerary} />}
        </Section>
      )}
      {budget && (
        <Section id="trip-budget" agent={budget} skeleton="panel">
          {trip.budget && <BudgetMeter budget={trip.budget} />}
        </Section>
      )}
      {support && (
        <Section id="trip-bookings" agent={support} skeleton="panel">
          {support.data != null && (
            <BookingCard support={support.data as Parameters<typeof BookingCard>[0]["support"]} />
          )}
        </Section>
      )}
    </div>
  );
}

/** Planning activity — when each specialist ran and which tools it used. */
export function ActivityTimeline({
  agents,
}: {
  agents: Map<string, AgentActivity>;
}) {
  const list = [...agents.values()].sort((a, b) => a.startedAt - b.startedAt);
  const running = list.some((a) => a.state === "running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  if (list.length === 0)
    return (
      <div className="scroll">
        <div className="empty-activity">
          <Icon name="sparkle" size={22} />
          <p>
            When Roam starts researching, you can follow each specialist and
            every search it runs here.
          </p>
        </div>
      </div>
    );

  const start = Math.min(...list.map((a) => a.startedAt));
  const end = Math.max(...list.map((a) => a.finishedAt ?? now), start + 1);
  const span = end - start;
  const calls = list.reduce((n, a) => n + a.tools.length, 0);

  return (
    <div className="scroll">
      <div className="activity-summary">
        <div>
          <strong>{list.length}</strong>
          <span>specialist{list.length === 1 ? "" : "s"}</span>
        </div>
        <div>
          <strong>{calls}</strong>
          <span>search{calls === 1 ? "" : "es"}</span>
        </div>
        <div>
          <strong className="price">{(span / 1000).toFixed(1)}s</strong>
          <span>{running ? "so far" : "start to finish"}</span>
        </div>
      </div>
      <ol className="activity-list">
        {list.map((a) => {
          const meta = agentMeta(a.agentId);
          const stop = a.finishedAt ?? now;
          return (
            <li key={a.agentId} className={`activity ${a.state}`}>
              <div className="activity-head">
                <span className="section-icon">
                  <Icon name={meta.icon} size={17} />
                </span>
                <strong>{meta.label}</strong>
                <span className={`status-chip ${a.state}`}>
                  {a.state === "running" && <span className="spinner" aria-hidden="true" />}
                  {a.state === "running"
                    ? "Working"
                    : a.state === "done"
                      ? `${((stop - a.startedAt) / 1000).toFixed(1)}s`
                      : a.state === "needs_input"
                        ? "Needs input"
                        : "Failed"}
                </span>
              </div>
              <div
                className="gantt"
                role="img"
                aria-label={`Ran from ${((a.startedAt - start) / 1000).toFixed(1)}s to ${((stop - start) / 1000).toFixed(1)}s`}
              >
                <span
                  style={{
                    left: `${((a.startedAt - start) / span) * 100}%`,
                    width: `${Math.max(1.5, ((stop - a.startedAt) / span) * 100)}%`,
                  }}
                />
              </div>
              <p className="activity-task">{a.task}</p>
              {a.tools.length > 0 && (
                <ul className="tool-calls" aria-label={`${meta.label} searches`}>
                  {a.tools.map((t, i) => (
                    <li key={i}>
                      <span>{describeTool(t.tool, t.argsPreview)}</span>
                      <code>{t.tool}</code>
                    </li>
                  ))}
                </ul>
              )}
              {a.summary && <p className="activity-result">{a.summary}</p>}
              {!!a.sources?.length && (
                <details className="activity-result">
                  <summary>Web sources ({a.sources.length})</summary>
                  <ul>
                    {a.sources.filter(s => /^https?:\/\//i.test(s.url)).map(s => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
                        {" — checked "}{s.retrievedAt.slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
