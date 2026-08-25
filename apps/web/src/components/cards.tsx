"use client";

import type {
  CarRentalOption,
  FlightOption,
  HotelOption,
  ItineraryDay,
  BudgetAgentOutput,
  SupportAgentOutput,
} from "@concierge/core";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  });

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

export function FlightCard({
  flight,
  selected,
  onSelect,
}: {
  flight: FlightOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const h = Math.floor(flight.durationMinutes / 60);
  const m = flight.durationMinutes % 60;
  return (
    <button
      className={`card selectable${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="title">
        {flight.carrier} {flight.flightNumber}
      </div>
      <div>
        {flight.origin} → {flight.destination}
      </div>
      <div className="muted">
        {time(flight.departLocal)} – {time(flight.arriveLocal)} · {h}h {m}m
      </div>
      <div className="muted">
        {flight.stops === 0 ? "direct" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`} ·{" "}
        {flight.fareClass}
      </div>
      <div className="big-price price">{usd(flight.fare.amount)}</div>
      {flight.stops === 0 && <span className="badge">★ direct</span>}
      {flight.holdAvailable && <span className="badge">hold available</span>}
      {selected && <span className="badge">✓ selected</span>}
    </button>
  );
}

export function HotelCard({
  hotel,
  selected,
  onSelect,
}: {
  hotel: HotelOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`card selectable${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      style={{ maxWidth: 240 }}
    >
      {hotel.photoUrl && (
        // plain <img>: mock photo URLs, no next/image optimization needed
        <img
          src={hotel.photoUrl}
          alt={hotel.name}
          style={{ borderRadius: 8, width: "100%", height: 110, objectFit: "cover" }}
        />
      )}
      <div className="title">{hotel.name}</div>
      <div className="muted">
        ★{hotel.starRating} · {hotel.reviewScore.toFixed(1)} · {hotel.neighborhood}
      </div>
      <div className="big-price price">
        {usd(hotel.pricePerNight.amount)}
        <span className="muted" style={{ fontSize: 13 }}> /night</span>
      </div>
      <div className="muted price">{usd(hotel.totalForStay.amount)} total</div>
      <div className="chip-row">
        {hotel.amenities.slice(0, 2).map((a) => (
          <span key={a} className="chip" style={{ pointerEvents: "none" }}>
            {a}
          </span>
        ))}
      </div>
      <div className="muted">{hotel.distanceNote}</div>
      {selected && <span className="badge">✓ selected</span>}
    </button>
  );
}

export function CarRentalCard({
  rental,
  selected,
  onSelect,
}: {
  rental: CarRentalOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`card selectable${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      style={{ maxWidth: 240 }}
    >
      <div className="title">
        {rental.company} · {rental.carClass}
      </div>
      <div className="muted">{rental.exampleModel}</div>
      <div className="muted">
        {rental.seats} seats · {rental.pickupLocation}
      </div>
      <div className="big-price price">
        {usd(rental.pricePerDay.amount)}
        <span className="muted" style={{ fontSize: 13 }}> /day</span>
      </div>
      <div className="muted price">{usd(rental.totalForTrip.amount)} total</div>
      <div className="chip-row">
        {rental.unlimitedMiles && (
          <span className="chip" style={{ pointerEvents: "none" }}>unlimited miles</span>
        )}
        {rental.freeCancellation && (
          <span className="chip" style={{ pointerEvents: "none" }}>free cancel</span>
        )}
      </div>
      {selected && <span className="badge">✓ selected</span>}
    </button>
  );
}

export function ItineraryDayCard({ day }: { day: ItineraryDay }) {
  return (
    <div className="card" style={{ minWidth: 250, maxWidth: 290 }}>
      <div className="title">{day.dayLabel}</div>
      {day.weather && (
        <div className="muted">
          {day.weather.summary} · {Math.round(day.weather.highF)}° /{" "}
          {Math.round(day.weather.lowF)}°F
        </div>
      )}
      {day.stops.map((s, i) => (
        <div key={i}>
          <span className="badge">{s.timeOfDay}</span> <strong>{s.title}</strong>
          <div className="muted">{s.description}</div>
        </div>
      ))}
      {day.mealPick && <div className="muted">🍽 {day.mealPick}</div>}
      {day.estimatedDailySpend && (
        <div className="muted price">≈ {usd(day.estimatedDailySpend.amount)} / day</div>
      )}
    </div>
  );
}

export function BudgetMeter({ budget }: { budget: BudgetAgentOutput }) {
  const cap = budget.cap?.amount;
  const denom = Math.max(budget.total.amount, cap ?? 0) || 1;
  return (
    <div className="card" style={{ minWidth: 320, flex: 1 }}>
      <div className="meter" role="img" aria-label="budget breakdown">
        {budget.segments.map((s) => (
          <div
            key={s.label}
            className={`seg-${s.label}`}
            style={{ width: `${(s.amount.amount / denom) * 100}%` }}
            title={`${s.label}: ${usd(s.amount.amount)}`}
          />
        ))}
      </div>
      <div className="price">
        <strong>{usd(budget.total.amount)}</strong>
        {cap != null && <span className="muted"> / {usd(cap)}</span>}{" "}
        <span
          style={{
            color:
              budget.overUnder === "over" ? "var(--danger)" : "var(--success)",
          }}
        >
          {budget.overUnder === "over" ? "over budget" : budget.overUnder === "at" ? "at budget" : "under budget"}
        </span>
      </div>
      <div className="chip-row">
        {budget.segments.map((s) => (
          <span key={s.label} className="muted" style={{ fontSize: 12 }}>
            {s.label} {usd(s.amount.amount)}
          </span>
        ))}
      </div>
      {budget.topTradeOff && <div className="muted">💡 {budget.topTradeOff}</div>}
    </div>
  );
}

export function BookingCard({ support }: { support: SupportAgentOutput }) {
  return (
    <div className="card" style={{ minWidth: 260 }}>
      {support.tripLabel && <div className="title">{support.tripLabel}</div>}
      {support.confirmationCode && (
        <div className="muted">conf. {support.confirmationCode}</div>
      )}
      {support.dates && <div className="muted">{support.dates}</div>}
      {support.bookingStatus && (
        <span
          className={`status-chip ${support.bookingStatus === "cancelled" ? "failed" : "done"}`}
          style={{ alignSelf: "flex-start" }}
        >
          {support.bookingStatus.replace("_", " ")}
        </span>
      )}
      {support.refund && (
        <div className="price">
          refund {usd(support.refund.amount.amount)} → {support.refund.method}
        </div>
      )}
      <div>{support.resolution}</div>
      {support.ticketId && <div className="muted">ticket {support.ticketId}</div>}
    </div>
  );
}
