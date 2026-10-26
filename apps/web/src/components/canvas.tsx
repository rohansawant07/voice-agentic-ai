"use client";

import { useState } from "react";
import { Icon } from "./icon";
import type {
  BudgetAgentOutput,
  CarRentalAgentOutput,
  FlightAgentOutput,
  HotelAgentOutput,
  ItineraryAgentOutput,
  SupportAgentOutput,
} from "@concierge/core";
import type { AgentActivity } from "../lib/session";
import {
  BookingCard,
  BudgetMeter,
  CarRentalCard,
  FlightCard,
  HotelCard,
  ItineraryDayCard,
} from "./cards";

function SectionHeader({
  label,
  icon,
  agent,
}: {
  label: string;
  icon: string;
  agent: AgentActivity;
}) {
  return (
    <div className="section-header">
      <span>
        {icon} {label}
      </span>
      <span className={`status-chip ${agent.state}`} aria-live="polite">
        {agent.state === "done" && agent.durationMs != null
          ? `done · ${(agent.durationMs / 1000).toFixed(1)}s`
          : agent.state}
      </span>
    </div>
  );
}

function FailedNote({ agent }: { agent: AgentActivity }) {
  return (
    <div className="failed-note">
      {agent.summary ?? "Couldn't finish this one."}
    </div>
  );
}

/** Results tab — sections appear only when a specialist has activity (DESIGN §5.2). */
export function ResultsCanvas({
  agents,
  onSelectionChange,
  onInspiration,
}: {
  agents: Map<string, AgentActivity>;
  onInspiration: (prompt: string) => void;
  onSelectionChange: (kind: "flight" | "hotel" | "car", id: string) => void;
}) {
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  const [selectedHotel, setSelectedHotel] = useState<string | null>(null);
  const [selectedCar, setSelectedCar] = useState<string | null>(null);

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

  const flightData = flight?.data as FlightAgentOutput | undefined;
  const hotelData = hotel?.data as HotelAgentOutput | undefined;
  const carData = car?.data as CarRentalAgentOutput | undefined;
  const itinData = itinerary?.data as ItineraryAgentOutput | undefined;
  const budgetData = budget?.data as BudgetAgentOutput | undefined;
  const supportData = support?.data as SupportAgentOutput | undefined;

  return (
    <div className="scroll" style={{ gap: 20 }}>
      {flight && (
        <section className="section">
          <SectionHeader label="Flights" icon="✈️" agent={flight} />
          {flight.state === "failed" && <FailedNote agent={flight} />}
          {flightData?.options && (
            <div className="card-row">
              {flightData.options.map((f) => (
                <FlightCard
                  key={f.id}
                  flight={f}
                  selected={selectedFlight === f.id}
                  onSelect={() => {
                    setSelectedFlight(f.id);
                    onSelectionChange("flight", f.id);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {hotel && (
        <section className="section">
          <SectionHeader label="Places to stay" icon="🏨" agent={hotel} />
          {hotel.state === "failed" && <FailedNote agent={hotel} />}
          {hotelData?.notes && <div className="muted">{hotelData.notes}</div>}
          {hotelData?.vacationRentals?.length ? (
            <div className="card-row">
              {hotelData.vacationRentals.map((rental) => (
                <div className="card" key={rental.id} style={{ maxWidth: 280 }}>
                  <span className="badge">Airbnb · verify availability</span>
                  <div className="title">{rental.name}</div>
                  {rental.priceText && (
                    <div className="price">{rental.priceText}</div>
                  )}
                  {rental.priceDetail && (
                    <div className="muted">{rental.priceDetail}</div>
                  )}
                  <a
                    href={rental.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Airbnb ↗
                  </a>
                </div>
              ))}
            </div>
          ) : null}
          {hotelData?.searchLinks?.length ? (
            <div className="card-row">
              {hotelData.searchLinks.map((link) => (
                <div className="card" key={link.url} style={{ maxWidth: 300 }}>
                  <div className="title">Airbnb · {link.destination}</div>
                  <div className="muted">
                    {hotelData.rentalSearchStatus === "live_results"
                      ? "Check final dates, location, prices and fees on Airbnb."
                      : "Search link only — live listings and prices have not been verified."}
                  </div>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    Search stays on Airbnb ↗
                  </a>
                </div>
              ))}
            </div>
          ) : null}
          {hotelData?.options && (
            <div className="card-row">
              {hotelData.options.map((h) => (
                <HotelCard
                  key={h.id}
                  hotel={h}
                  selected={selectedHotel === h.id}
                  onSelect={() => {
                    setSelectedHotel(h.id);
                    onSelectionChange("hotel", h.id);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {car && (
        <section className="section">
          <SectionHeader label="Getting around" icon="🚗" agent={car} />
          {car.state === "failed" && <FailedNote agent={car} />}
          {carData?.options && (
            <div className="card-row">
              {carData.options.map((r) => (
                <CarRentalCard
                  key={r.id}
                  rental={r}
                  selected={selectedCar === r.id}
                  onSelect={() => {
                    setSelectedCar(r.id);
                    onSelectionChange("car", r.id);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {itinerary && (
        <section className="section">
          <SectionHeader label="Your itinerary" icon="🗺️" agent={itinerary} />
          {itinerary.state === "failed" && <FailedNote agent={itinerary} />}
          {(itinData?.notes || itinData?.sources?.length) && (
            <details className="planning-notes">
              <summary>Sources & planning notes</summary>
              {itinData.notes && <p>{itinData.notes}</p>}
              {itinData.sources?.map(
                (source) =>
                  /^https:\/\//.test(source.url) && (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title} ↗
                    </a>
                  ),
              )}
            </details>
          )}
          {itinData?.days && (
            <div className="card-row">
              {itinData.days.map((d) => (
                <ItineraryDayCard key={`${d.date}-${d.dayLabel}`} day={d} />
              ))}
            </div>
          )}
          {itinData?.dietaryNote && (
            <div className="muted">🥗 {itinData.dietaryNote}</div>
          )}
          {itinData?.destinations && (
            <div className="card-row">
              {itinData.destinations.map((d) => (
                <div
                  key={d.destination}
                  className="card"
                  style={{ maxWidth: 230 }}
                >
                  <div className="title">{d.destination}</div>
                  {d.avgTempF != null && (
                    <div className="muted">avg {Math.round(d.avgTempF)}°F</div>
                  )}
                  {d.flightPriceFrom && (
                    <div className="muted price">
                      flights from ${d.flightPriceFrom.amount}
                    </div>
                  )}
                  <div>{d.pitch}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {budget && (
        <section className="section">
          <SectionHeader label="Trip budget" icon="💵" agent={budget} />
          {budget.state === "failed" && <FailedNote agent={budget} />}
          {budgetData && <BudgetMeter budget={budgetData} />}
        </section>
      )}
      {support && (
        <section className="section">
          <SectionHeader label="Bookings" icon="🎫" agent={support} />
          {support.state === "failed" && <FailedNote agent={support} />}
          {supportData && <BookingCard support={supportData} />}
        </section>
      )}
    </div>
  );
}

const AGENT_ICONS: Record<string, string> = {
  "flight-agent": "✈️",
  "hotel-agent": "🏨",
  "car-rental-agent": "🚗",
  "itinerary-agent": "🗺️",
  "budget-agent": "💵",
  "support-agent": "🎫",
};

/** Agents tab — the fan-out graph + tool ticker (DESIGN §5.2). */
export function AgentsGraph({
  agents,
}: {
  agents: Map<string, AgentActivity>;
}) {
  const list = [...agents.values()];
  const delegations = list.length;
  return (
    <div className="scroll">
      <div className="agents-graph">
        <div className="orchestrator-node">
          Roam is connecting the dots
          <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
            {delegations} delegation{delegations === 1 ? "" : "s"}
          </div>
        </div>
        <div className="fan-edges">
          {delegations > 0 ? "┌─────┼─────┐" : "│"}
        </div>
        <div className="agent-row">
          {list.length === 0 && (
            <div className="muted">
              As you plan, you can follow the research for your trip here.
            </div>
          )}
          {list.map((a) => (
            <div key={a.agentId} className={`agent-node ${a.state}`}>
              <div className="name">
                {AGENT_ICONS[a.agentId] ?? "🤖"}{" "}
                {a.agentId.replace("-agent", "")}{" "}
                {a.state === "done" ? "✔" : a.state === "failed" ? "✕" : "●"}
                {a.durationMs != null && (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {" "}
                    {(a.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="task">{a.task}</div>
              {a.tools.length > 0 && (
                <div className="ticker" aria-live="polite">
                  {a.tools.map((t, i) => (
                    <div key={i}>
                      └ {t.tool}(
                      {Object.entries(t.argsPreview)
                        .slice(0, 3)
                        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                        .join(", ")}
                      )
                    </div>
                  ))}
                </div>
              )}
              {a.summary && <div className="muted">{a.summary}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
