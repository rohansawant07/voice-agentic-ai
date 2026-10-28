"use client";

import { useState } from "react";
import type {
  CarRentalOption,
  FlightOption,
  HotelOption,
  ItineraryAgentOutput,
  ItineraryDay,
  BudgetAgentOutput,
  SupportAgentOutput,
} from "@concierge/core";
import { Icon } from "./icon";
import { clock, hm, usd } from "../lib/trip";

function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <span className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  );
}

function Picked({ selected }: { selected: boolean }) {
  return (
    <span className={`pick-mark${selected ? " on" : ""}`} aria-hidden="true">
      {selected && <Icon name="check" size={13} />}
    </span>
  );
}

export function FlightRow({
  flight,
  tags,
  travelers,
  selected,
  onSelect,
}: {
  flight: FlightOption;
  tags?: string[];
  travelers?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const stops =
    flight.stops === 0
      ? "Nonstop"
      : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`;
  return (
    <button
      className={`option-row flight-row${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <Picked selected={selected} />
      <span className="row-main">
        <strong>{flight.carrier}</strong>
        <small>
          {flight.flightNumber} · {flight.fareClass}
        </small>
      </span>
      <span className="row-times">
        <strong>
          {clock(flight.departLocal)} – {clock(flight.arriveLocal)}
        </strong>
        <small>
          {flight.origin} → {flight.destination}
        </small>
      </span>
      <span className="row-meta">
        <strong>{hm(flight.durationMinutes)}</strong>
        <small className={flight.stops === 0 ? "good" : undefined}>{stops}</small>
      </span>
      <span className="row-price">
        <strong className="price">{usd(flight.fare.amount)}</strong>
        <small>
          {travelers && travelers > 1
            ? `per person · ${usd(flight.fare.amount * travelers)} total`
            : "per person"}
        </small>
      </span>
      <span className="row-tags">
        <Tags tags={tags} />
        {flight.holdAvailable && <span className="tag quiet">Hold available</span>}
      </span>
    </button>
  );
}

export function HotelCard({
  hotel,
  tags,
  selected,
  onSelect,
}: {
  hotel: HotelOption;
  tags?: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`stay-card${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {hotel.photoUrl && (
        // plain <img>: mock photo URLs, no next/image optimization needed
        <img className="stay-photo" src={hotel.photoUrl} alt="" loading="lazy" />
      )}
      <span className="stay-top">
        <Tags tags={tags} />
        <Picked selected={selected} />
      </span>
      <strong className="stay-name">{hotel.name}</strong>
      <span className="stay-place">{hotel.neighborhood}</span>
      <span className="stay-rating">
        <Icon name="star" size={14} />
        <strong>{hotel.reviewScore.toFixed(1)}</strong>
        <span>guest rating</span>
        <span className="sep" />
        <span>{hotel.starRating.toFixed(1)}-star</span>
      </span>
      <span className="stay-distance">{hotel.distanceNote}</span>
      <span className="stay-amenities">
        {hotel.amenities
          .filter((a) => a !== hotel.distanceNote)
          .slice(0, 3)
          .map((a) => (
            <span key={a}>{a}</span>
          ))}
      </span>
      <span className="stay-price">
        <strong className="price">{usd(hotel.pricePerNight.amount)}</strong>
        <span> / night</span>
        <small className="price">{usd(hotel.totalForStay.amount)} for the stay</small>
      </span>
    </button>
  );
}

const CAR_CLASS: Record<CarRentalOption["carClass"], string> = {
  economy: "Economy",
  compact: "Compact",
  midsize: "Midsize",
  suv: "SUV",
  minivan: "Minivan",
  convertible: "Convertible",
};

export function CarRow({
  rental,
  tags,
  selected,
  onSelect,
}: {
  rental: CarRentalOption;
  tags?: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`option-row car-row${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <Picked selected={selected} />
      <span className="row-main">
        <strong>
          {rental.company}{" "}
          <span className="car-class">{CAR_CLASS[rental.carClass]}</span>
        </strong>
        <small>{rental.exampleModel}</small>
      </span>
      <span className="row-times">
        <strong>{rental.seats} seats</strong>
        <small>{rental.pickupLocation}</small>
      </span>
      <span className="row-meta">
        <strong>{rental.unlimitedMiles ? "Unlimited miles" : "Mileage limits"}</strong>
        <small className={rental.freeCancellation ? "good" : undefined}>
          {rental.freeCancellation ? "Free cancellation" : "Non-refundable"}
        </small>
      </span>
      <span className="row-price">
        <strong className="price">{usd(rental.totalForTrip.amount)}</strong>
        <small className="price">{usd(rental.pricePerDay.amount)} / day</small>
      </span>
      <span className="row-tags">
        <Tags tags={tags} />
      </span>
    </button>
  );
}

const TIME_ORDER = { morning: 0, afternoon: 1, evening: 2 } as const;

function DayPanel({ day }: { day: ItineraryDay }) {
  const stops = [...day.stops].sort(
    (a, b) => TIME_ORDER[a.timeOfDay] - TIME_ORDER[b.timeOfDay],
  );
  return (
    <div className="day-panel">
      <div className="day-facts">
        {day.weather && (
          <span>
            <Icon name="cloud" size={16} />
            {day.weather.summary}, {Math.round(day.weather.highF)}° /{" "}
            {Math.round(day.weather.lowF)}°F
          </span>
        )}
        {day.estimatedDailySpend && (
          <span className="price">
            <Icon name="wallet" size={16} />
            About {usd(day.estimatedDailySpend.amount)} for the day
          </span>
        )}
      </div>
      <ol className="timeline">
        {stops.map((s, i) => (
          <li key={i} className="timeline-stop">
            <span className="time-of-day">{s.timeOfDay}</span>
            <div>
              <strong>{s.title}</strong>
              <p>{s.description}</p>
              {s.estimatedCost && (
                <small className="price">≈ {usd(s.estimatedCost.amount)}</small>
              )}
            </div>
          </li>
        ))}
      </ol>
      {day.mealPick && (
        <p className="meal-pick">
          <strong>Where to eat:</strong> {day.mealPick}
        </p>
      )}
    </div>
  );
}

export function Itinerary({ data }: { data: ItineraryAgentOutput }) {
  const [active, setActive] = useState(0);
  const days = data.days ?? [];
  const day = days[Math.min(active, days.length - 1)];
  return (
    <>
      {days.length > 0 && (
        <div className="itinerary">
          <div className="day-tabs" role="tablist" aria-label="Trip days">
            {days.map((d, i) => {
              const [label, date] = d.dayLabel.split(" · ");
              return (
                <button
                  key={`${d.date}-${d.dayLabel}`}
                  role="tab"
                  id={`day-tab-${i}`}
                  aria-selected={i === active}
                  aria-controls="day-panel"
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => {
                    const step =
                      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const next = (i + step + days.length) % days.length;
                    setActive(next);
                    document.getElementById(`day-tab-${next}`)?.focus();
                  }}
                >
                  <strong>{label}</strong>
                  {date && <small>{date}</small>}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" id="day-panel" aria-labelledby={`day-tab-${active}`}>
            {day && <DayPanel day={day} />}
          </div>
        </div>
      )}
      {data.dietaryNote && <p className="note-line">{data.dietaryNote}</p>}
      {data.destinations && (
        <div className="destination-grid">
          {data.destinations.map((d) => (
            <div key={d.destination} className="destination-card">
              <strong>{d.destination}</strong>
              <p>{d.pitch}</p>
              <span className="destination-facts">
                {d.driveTime && (
                  <span title="Free-flow estimate from OpenStreetMap roads via OSRM; excludes traffic and stops">
                    {d.driveTime.label} drive from {d.driveTime.from.split(",")[0]}, without traffic
                  </span>
                )}
                {d.avgTempF != null && <span>Avg {Math.round(d.avgTempF)}°F</span>}
                {d.flightPriceFrom && (
                  <span className="price">Flights from {usd(d.flightPriceFrom.amount)}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {(data.notes || data.sources?.length) && (
        <details className="planning-notes">
          <summary>Sources and planning notes</summary>
          {data.notes && <p>{data.notes}</p>}
          {data.sources?.map(
            (source) =>
              /^https:\/\//.test(source.url) && (
                <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title} <Icon name="link" size={13} />
                </a>
              ),
          )}
        </details>
      )}
    </>
  );
}

const SEGMENT_LABELS: Record<string, string> = {
  flights: "Flights",
  stay: "Stay",
  car: "Car",
  activities: "Activities",
  food: "Food",
  other: "Other",
};

export function BudgetMeter({ budget }: { budget: BudgetAgentOutput }) {
  const cap = budget.cap?.amount;
  const denom = Math.max(budget.total.amount, cap ?? 0) || 1;
  return (
    <div className="panel budget-panel">
      <div className="budget-figure">
        <strong className="price">{usd(budget.total.amount)}</strong>
        {cap != null && <span className="price"> of {usd(cap)}</span>}
        <span className={`budget-state ${budget.overUnder}`}>
          {budget.overUnder === "over"
            ? "Over budget"
            : budget.overUnder === "at"
              ? "At budget"
              : "Under budget"}
        </span>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={budget.segments
          .map((s) => `${SEGMENT_LABELS[s.label]} ${usd(s.amount.amount)}`)
          .join(", ")}
      >
        {budget.segments.map((s) => (
          <div
            key={s.label}
            className={`seg-${s.label}`}
            style={{ width: `${(s.amount.amount / denom) * 100}%` }}
          />
        ))}
      </div>
      <ul className="legend">
        {budget.segments.map((s) => (
          <li key={s.label}>
            <span className={`swatch seg-${s.label}`} />
            {SEGMENT_LABELS[s.label]}
            <strong className="price">{usd(s.amount.amount)}</strong>
          </li>
        ))}
      </ul>
      {budget.topTradeOff && <p className="note-line">{budget.topTradeOff}</p>}
    </div>
  );
}

export function BookingCard({ support }: { support: SupportAgentOutput }) {
  return (
    <div className="panel booking-panel">
      <div className="booking-top">
        {support.tripLabel && <strong>{support.tripLabel}</strong>}
        {support.bookingStatus && (
          <span
            className={`status-chip ${support.bookingStatus === "cancelled" ? "failed" : "done"}`}
          >
            {support.bookingStatus.replace("_", " ")}
          </span>
        )}
      </div>
      <dl>
        {support.confirmationCode && (
          <>
            <dt>Confirmation</dt>
            <dd>{support.confirmationCode}</dd>
          </>
        )}
        {support.dates && (
          <>
            <dt>Dates</dt>
            <dd>{support.dates}</dd>
          </>
        )}
        {support.refund && (
          <>
            <dt>Refund</dt>
            <dd className="price">
              {usd(support.refund.amount.amount)} to {support.refund.method}
            </dd>
          </>
        )}
        {support.ticketId && (
          <>
            <dt>Ticket</dt>
            <dd>{support.ticketId}</dd>
          </>
        )}
      </dl>
      <p>{support.resolution}</p>
    </div>
  );
}
