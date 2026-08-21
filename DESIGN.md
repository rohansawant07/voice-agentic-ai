# Concierge — Design Document

> Companion to [README.md](README.md) (the architecture brain). This file is the **design brain**: what we're building for whom, how every screen looks and behaves, and the order the design work gets done. If a UI decision isn't here, it isn't decided.

**Inspiration DNA** (researched, deliberate): Mindtrip (split pane, conversation drives a live canvas) · Layla (conversational warmth) · Wonderplan (itinerary + budget cards) · Airbnb (card anatomy) · Kayak / Google Flights (comparison density) · [orb-ui](https://orb-ui.com/) (voice orb component, 4 states).

---

## 1. Design Principles

1. **Voice-first, never voice-only.** Every action has a spoken path *and* a visible/typed path. Text input is a first-class citizen, not a fallback apology.
2. **Results stream in; no spinner walls.** The canvas fills card-by-card as each specialist finishes. Waiting is shown as *progress you can watch*, not a blank loader.
3. **Machinery on demand.** Customers see results. The orchestration graph lives one tab away (Agents tab) — always available, never in the way. Demos flip the tab; customers never have to.
4. **Speakable ≠ readable.** The assistant produces two renderings of every answer: short spoken sentences (no lists, rounded prices, "about four hundred dollars") and rich visual cards (exact prices, full details). Never read a table aloud; never speak more than ~3 sentences without checking in.
5. **Calm consumer polish.** Whitespace, photography, one accent color. The energy comes from motion (cards landing, orb breathing), not from dashboard density.

---

## 2. Users & Core Scenarios

**Who:** US-based leisure travelers — weekend-getaway couples, family vacation planners, solo trip takers. Comfortable talking to AI; impatient with forms.

**Where:** US + territories (Puerto Rico, USVI, Hawaii, Alaska, Guam). USD everywhere. International expansion is a later milestone (see §3).

Each scenario names the specialists that fire — this doubles as the routing spec and the eval seed list (README §7.1).

| # | Spoken request | Specialists fired | Canvas outcome |
|---|---|---|---|
| S1 | "Book me a long weekend in San Juan under $1,500" | flight + hotel + itinerary + budget **in parallel** | 3 flight cards, 3 hotel cards, 3-day itinerary, budget meter at ~$1,380 |
| S2 | "Find me a beach trip in February, somewhere warm" | itinerary (weather-led) → then flight + hotel | Destination compare cards (Miami vs. San Juan vs. Maui) with forecast chips; follow-up narrows |
| S3 | "What's the cheapest way to get my family of four to Orlando spring break week?" | flight + budget | Fare comparison grid, price-per-person, date-shift suggestions ("fly Tuesday, save $340") |
| S4 | "Cancel my Denver trip" | support (destructive → **spoken confirmation required**) | Booking card with red Cancel pending state → confirmed state after "yes" |
| S5 | "Move my Maui hotel to the following weekend" | support → hotel (recheck availability) | Before/after booking card diff, price delta highlighted |
| S6 | "It's our anniversary — plan something special, we like hiking and good food" | itinerary + hotel + flight + budget | Themed itinerary (national park + food scene, e.g. Sedona/Asheville), boutique stays |
| S7 | Out-of-domain: "What's the capital of France?" | none | Polite spoken redirect; no cards; no delegation (eval: routing precision) |

Clarifying-question rule: if origin city, dates, or party size are missing *and* materially change results, the orchestrator asks **one** compound spoken question ("When are you thinking, and flying from where?") with tappable suggestion chips in the transcript.

---

## 3. What Concierge Specializes In

**Deep (v1):**
- US domestic + territory **flights** — search, compare, fare rules, holds
- **Stays** — hotels, resorts, boutique properties
- **Weather-aware itineraries** — day-by-day plans that check the forecast before recommending a beach day; national-park and city-break literacy
- **Budget reasoning in USD** — total-trip math, trade-off suggestions ("drop to 3-star, upgrade the flight"), price-per-person
- **Booking support** — lookup, modify, cancel, refund status, escalation tickets

**Explicitly out of scope (v1)** — the orchestrator says so gracefully and offers what it *can* do:
- International fares, visas/passports, travel insurance, loyalty-program points math, car rentals, cruises

**Expansion path:** international = new MCP tools + registry `description` updates + new eval cases. No UI redesign — currency and locale are tokens from day one (`Intl.NumberFormat`, no hardcoded `$`).

---

## 4. Information Architecture & Screens

```
Landing ──▶ Session (main split-pane screen) ──▶ Trip summary (shareable)
                 │
                 └─▶ History drawer (past sessions, resume)
```

Three screens total. No settings page in v1 (voice/theme toggles live in a popover).

### 4.1 Landing

```
┌──────────────────────────────────────────────────────┐
│                                          ◐ theme  ⚙ │
│                                                      │
│                 C O N C I E R G E                    │
│         Your travel agency, on the line.             │
│                                                      │
│                      ╭──────╮                        │
│                      │  ◉   │  ← orb, idle/breathing │
│                      ╰──────╯                        │
│               "Tap and tell me where"                │
│                                                      │
│   ┌─────────────┐ ┌──────────────┐ ┌─────────────┐   │
│   │ 🏝 Weekend  │ │ 👨‍👩‍👧 Family    │ │ 🥾 National │   │
│   │ in San Juan │ │ Orlando trip │ │ park escape │   │
│   └─────────────┘ └──────────────┘ └─────────────┘   │
│          suggestion chips → start session            │
│                                                      │
│              [ or type your trip… ]                  │
└──────────────────────────────────────────────────────┘
```

Full-bleed muted destination photograph behind a soft scrim. One tap (orb or chip) starts a session.

### 4.2 Session — the main screen (spec in §5)

### 4.3 Trip summary

Read-only shareable page once a plan is settled: hero, day cards, bookings, total spend vs. budget. Export: link + PDF. This is Wonderplan's best idea, kept.

---

## 5. Main Screen Spec

```
┌────────────────────────────────────────────────────────────────────┐
│ ◉ Concierge      San Juan getaway          ⏱ live  #a41   ⋯ menu │
├───────────────────────────┬────────────────────────────────────────┤
│ CONVERSATION (40%)        │ CANVAS (60%)    [ Results ][ Agents ]  │
│                           │                                        │
│ ┌──────────────────────┐  │  FLIGHTS                    ✈️ done    │
│ │ You  "long weekend   │  │  ┌──────────┐┌──────────┐┌──────────┐ │
│ │ in san juan, under   │  │  │ JetBlue  ││ United   ││ Spirit   │ │
│ │ $1500 for two"       │  │  │ JFK→SJU  ││ EWR→SJU  ││ ...      │ │
│ └──────────────────────┘  │  │ $284 rt  ││ $312 rt  ││          │ │
│                           │  │ ★ direct ││ 1 stop   ││          │ │
│ ┌──────────────────────┐  │  └──────────┘└──────────┘└──────────┘ │
│ │ ◉  "Great news — I   │  │  STAYS                      🏨 done   │
│ │ found direct flights │  │  ┌────────────┐┌────────────┐         │
│ │ from $284 and three  │  │  │ [photo]    ││ [photo]    │         │
│ │ hotels that fit..."  │  │  │ La Concha  ││ O:LV Hotel │         │
│ └──────────────────────┘  │  │ ★4.5 Condado│ ★4.7      │         │
│                           │  │ $189/nt    ││ $240/nt    │         │
│ ┌╌╌ suggestion chips ╌╌┐  │  └────────────┘└────────────┘         │
│ ┆ Beachfront only ┆ Add ┆ │  ITINERARY            🗺️ running ▓▓░ │
│ ┆ a day ┆ Show map ┆    │ │  Day 1 · Old San Juan walk …          │
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘  │  BUDGET  ▓▓▓▓▓▓▓▓░░  $1,382 / $1,500  │
├───────────────────────────┴────────────────────────────────────────┤
│   [ type a message…            ]        ( ◉ )  ● listening         │
└────────────────────────────────────────────────────────────────────┘
```

### 5.1 Left pane — Conversation

- **User bubbles**: right-aligned; live STT partials render in a lighter weight and solidify on final transcript.
- **Assistant bubbles**: left-aligned with orb glyph; text is the *spoken* script (short, warm, Layla-tone) — visual detail belongs to the canvas. While speaking, the current sentence gets a subtle karaoke highlight synced to TTS.
- **Suggestion chips**: after each assistant turn, ≤3 tappable follow-ups ("Beachfront only", "Add a day", "Show the map"). Tapping = sending that text.
- **Clarify chips**: when the orchestrator asks a question, likely answers render as chips ("This weekend", "Next weekend", "Flexible").
- **Confirmation card** (destructive actions only): inline red-bordered card — "Cancel Denver trip, refund $412 to Visa ····4242?" with **Confirm** / **Keep it** buttons; spoken "yes" activates Confirm. Mirrors README §3's `destructive: true` rule exactly.

### 5.2 Right pane — Canvas

**Results tab (default).** Sectioned vertical scroll: FLIGHTS / STAYS / ITINERARY / MAP / BUDGET. Sections appear only when a specialist returns data — each section header carries the specialist's live status chip (`pending · running · done · failed`). Cards animate in (120ms fade + 8px rise, staggered 60ms) the moment their agent completes — this is the "streaming" feel of Principle 2.

- **Selection model**: tapping a flight/hotel card selects it (accent border + ✓); budget meter recomputes instantly client-side; orchestrator is informed on next turn.
- **Map**: pins for hotels + itinerary stops; hovering a card highlights its pin (Mindtrip's core trick).
- **Failed state**: section shows a plain sentence ("Couldn't reach the flight search — retrying") + retry affordance; never an empty section.

**Agents tab.** The engineering showpiece:

```
                 ┌─────────────────┐
                 │  ORCHESTRATOR   │ 2.1s · 3 delegations
                 └───┬────┬────┬───┘
              ┌──────┘    │    └───────┐
        ✈️ flight    🏨 hotel     🗺️ itinerary
        ✔ done 1.9s  ✔ done 2.3s  ● running 1.2s
        └ search_flights(SJU, Fri–Mon)   ← tool-call ticker,
        └ get_fare_rules(B6-1203)          newest on top
```

- Nodes: pending (gray) → running (accent pulse) → done (green ✔ + duration) → failed (red ✕ + reason).
- Edges draw when a delegation starts. Parallel delegations visibly fan out simultaneously — *the* demo moment.
- Clicking a node opens a side sheet: task given, tools called with args (sensitive values masked), structured result, tokens, latency.
- Data source: the WS events already specified in README §4 (`delegation_started`, `tool_called`, `delegation_finished`). No new backend surface needed.

### 5.3 Bottom bar — Voice

- **Orb** (orb-ui): `idle` breathing → `listening` audio-reactive ripple (user's mic) → `thinking` slow internal swirl → `speaking` waveform pulse (TTS energy).
- **Interactions**: tap = toggle listening; hold = push-to-talk; `Space` = PTT on desktop; `Esc` = stop speaking.
- **Status label** under orb: "listening…", "thinking…", "3 agents working…" (live count from WS events).
- **Text field** sits beside the orb, always visible (Principle 1).

### 5.4 Responsive

- **Desktop ≥1024px**: split pane as drawn.
- **Tablet/mobile**: panes become swipeable full-width views (Conversation ⇄ Canvas); orb floats bottom-center over both; a card-count badge on the Canvas tab pulls attention when results land.

---

## 6. Component Inventory (design ↔ `packages/core` contract)

Every card maps 1:1 to a specialist `outputSchema` (README §2.2). Fields listed here are the schema fields — if design needs a field, it goes in the Zod schema, and vice versa.

| Component | Source agent | Fields rendered | Anatomy reference |
|---|---|---|---|
| **FlightCard** | flight-agent | carrier + logo, flight no., origin→dest codes, depart/arrive local times, duration, stops, fare USD, fare class, `holdAvailable` | Kayak result row, card-ified |
| **HotelCard** | hotel-agent | photo, name, star rating, review score, neighborhood, $/night, total for stay, 2 amenity chips, walk-to-beach/center distance | Airbnb card |
| **ItineraryDayCard** | itinerary-agent | day label + date, weather chip (icon + hi/lo °F), 3–5 stops with time-of-day grouping, meal pick, est. daily spend | Wonderplan day column |
| **DestinationCard** (S2) | itinerary-agent | hero photo, destination, Feb avg temp, flight-price-from, one-line pitch | Mindtrip explore card |
| **BudgetMeter** | budget-agent | segmented bar (flights/stay/activities/food), total vs. cap, over/under state, top trade-off suggestion | — |
| **BookingCard** | support-agent | confirmation code, trip label, dates, status (`confirmed / pending-change / cancelled / refund-issued`), refund amount + method | — |
| **ConfirmationCard** | orchestrator | action sentence, monetary consequence, Confirm/Keep-it | — |
| **AgentNode / ToolTicker** | WS events | id, state, duration, current tool + masked args | — |
| **StatusChip, SuggestionChip, MapPanel, TranscriptBubble, Orb** | — | shared primitives | orb-ui for Orb |

---

## 7. Voice UX Spec

- **Turn-taking**: endpointing at ~800ms silence (STT provider VAD). The orb stops listening visibly (ripple collapses) so users know the turn was taken.
- **Latency cover**: if a run will exceed **3s**, speak one filler sentence *once* ("Let me check flights and hotels — one moment.") — README §4's threshold. Never stack fillers; the canvas activity is the ongoing feedback.
- **Barge-in**: user speech during TTS playback pauses TTS within 200ms, orb flips to listening, partial answer stays in transcript. Interrupting is a feature, not an error.
- **Repair phrases**: low-confidence STT → "I think you said Maui — is that right?" with Yes/No chips. Two consecutive failures → "Mind typing that one?" (points at text field).
- **Destructive confirmation**: spoken "yes / confirm / go ahead" (or tapping Confirm) required after the ConfirmationCard renders. Anything else = abort, state unchanged. 100% eval gate (README §7.1).
- **Speakable style rules** (orchestrator prompt + judge rubric): ≤3 sentences per turn before yielding; round prices in speech ("about two-ninety round trip"), exact on cards; never enumerate more than 2 options aloud — "I've put three on your screen"; no URLs, no spelling out codes.
- **Multi-turn memory**: "actually make it 3 nights" re-delegates with prior context (session history, README §4); changed cards animate a diff (old price struck through, 400ms).

---

## 8. Visual Design System

**Tokens (CSS variables, light + dark from day one):**

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FAF9F7` warm off-white | `#101418` deep slate |
| `--surface` (cards) | `#FFFFFF` | `#1A2028` |
| `--text` / `--text-muted` | `#1A1D21` / `#6B7280` | `#F2F4F6` / `#96A0AB` |
| `--accent` (one only) | `#0E7C66` deep teal | `#2BB39A` |
| `--accent-warm` (photos/CTA tint) | `#E8865A` sunset coral (sparingly) | same |
| success / warn / danger | `#177E4D` / `#B4690E` / `#C2402A` | lightened variants |
| orb gradient | teal→coral radial, state-modulated | same, +glow |

- **Type**: humanist sans (Inter or General Sans). Scale 13 / 15 / 17 / 22 / 28 / 40. Transcript at 17px — conversation is the hero. Tabular numerals for all prices.
- **Spacing/shape**: 4px grid; cards `radius 16px`, chips `radius 999px`; shadows barely-there (`0 1px 3px rgba(0,0,0,.06)`), elevation via border + tint in dark mode.
- **Motion**: 120–200ms ease-out standard; card entrance fade+rise stagger 60ms; agent edges draw in 240ms; orb transitions spring-based (orb-ui defaults); respect `prefers-reduced-motion` (fades only, no orb pulse).
- **Imagery**: destination photography only in Landing hero, HotelCard, DestinationCard. Never as UI decoration.

**Accessibility (WCAG 2.1 AA):**
- Every spoken output is simultaneously visible as text (captions by architecture — the transcript *is* the caption track).
- Full keyboard + text-only path through every flow, including destructive confirmation.
- Agent status changes announced via `aria-live="polite"`; contrast ≥4.5:1 for text tokens (validated per theme); focus rings on accent, never suppressed.

---

## 9. Design Build Order

Step-by-step, each tied to a README milestone. Don't start a step until the one before it demos.

| Step | Deliverable | Unblocks |
|---|---|---|
| D1 | Low-fi wireframes of the 3 screens (this doc's ASCII → Figma-or-HTML rough) validated against scenarios S1–S7 | M1 |
| D2 | Design tokens implemented as CSS variables + light/dark toggle; type/spacing sheet | M1 |
| D3 | Static component set: TranscriptBubble, chips, FlightCard, HotelCard, ItineraryDayCard, BudgetMeter, BookingCard, ConfirmationCard, StatusChip (mock data, Storybook-style page) | M1 demo (text loop renders real cards) |
| D4 | Orb integration (orb-ui): 4 states wired to real mic/TTS energy; bottom bar with PTT + text field | M2 |
| D5 | Canvas streaming behavior: sections appear on WS events, card entrance motion, section status chips, failed states | M2 demo |
| D6 | Agents tab: fan-out graph, tool ticker, node detail sheet — driven by the same WS events | M2/M3 demos |
| D7 | MapPanel with card↔pin linking; Trip summary screen + share/PDF | M3 |
| D8 | Responsive/mobile pass; reduced-motion; AA contrast audit; empty/error states sweep | M4+ |

**Definition of done per step**: works in light *and* dark, keyboard path exists, and the relevant scenario from §2 can be walked through on screen.

---

*Change log: like README.md, this doc is updated in the same PR as any UI change that contradicts it.*
