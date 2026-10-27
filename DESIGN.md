# Roam — Current interface

Implemented October 26, 2026; trip board redesigned October 27, 2026. This document supersedes the early orb/swipe/dark-theme concepts; their history remains in Git.

## Product and visual direction

Roam is a conversational US travel planner. A user starts with a rough idea, discusses constraints, and reviews structured trip research. The interface must distinguish demo inventory, direct search links and sourced planning facts from verified availability or real bookings.

The visual system uses a white conversation area and a pale slate trip board, navy text and blue actions. Tokens live in `apps/web/src/app/globals.css`: background `#f3f5f8`, surface `#fff`, text `#172b45`, muted text `#68768a`, accent `#315ddd`, border `#e2e7ef`. Typography uses Avenir Next/Avenir with Segoe UI and sans-serif fallbacks; reading text is 13–15px (messages and composer 15px, 16px on mobile). Icons are local SVG components (no emoji); the inspiration photograph loads from Unsplash with a solid-color fallback. The trip summary is the one dark navy surface on the board, so the trip itself is the visual anchor.

## Desktop workspace

- Header (68px): Roam identity, US/territories scope and, once a conversation exists, **New trip** (clears the stored session and picks).
- Left pane: travel-companion status, welcome prompts or conversation, persistent composer, voice control and verification note.
- Right pane: trip board with Overview and Planning activity views; the title sits in the tab row.
- Empty board: scenic inspiration and direction prompts. These populate an editable draft; they do not submit requests automatically.
- After research, a **trip summary** leads the board: route or destination, dates and traveler count derived from specialist tool arguments, pick slots, an estimated total and a bar against the budget (the budget specialist's cap, else the last dollar amount the traveler typed). Pick slots exist only where demo inventory returned options. A provenance line states that prices are sample demo inventory and nothing is booked; with Airbnb links only, it says the links are unverified searches. **Copy plan** puts a plain-text plan with the same caveats on the clipboard.
- A sticky jump bar links to each section. Sections for flights, stays, rental cars, itinerary, budget and bookings appear for specialists with activity. Each header shows an icon, a count and provenance (for example "Round-trip sample fares, per person"), and a status chip with the duration.
- While a specialist runs, its section shows shimmer skeletons and its latest step in plain language (for example "Searching flights · JFK → SJU").
- Flights and cars are comparison rows; stays are cards. Tags are computed only from the options shown: Cheapest/Fastest for flights, Lowest price/Top rated for stays, Lowest price for cars. Flight prices are per person, with the party total when the traveler count is known.

## Conversation and voice

After a reply, up to three follow-up suggestions appear, drawn only from specialists that returned usable results; like inspiration prompts, they fill the draft rather than sending. Enter submits a nonempty draft; Shift+Enter adds a line. IME composition does not submit prematurely. Send is disabled while listening/planning. A thinking indicator appears while waiting. New messages scroll the transcript to the end; an empty welcome screen stays at the top.

The microphone button starts/stops recording; while a reply is speaking, it stops playback. Microphone permission failures produce a typed-input fallback message. Desktop Space supports push-to-talk outside interactive elements; Escape stops speech. Voice is available only when the backend reports STT enabled.

The backend transcribes after recording ends. It does not stream partial recognition. The browser buffers TTS audio until `tts_end`, then plays. Interrupting speech does not abort the entire model/tool request.

## Trip results and provenance

- Itineraries use keyboard-navigable day tabs (arrow keys). Each day shows weather and estimated spend, then a time-of-day timeline and the meal pick.
- Sources and planning notes are expandable alongside the itinerary.
- Airbnb links are explicitly labeled as search links with unverified listings/prices. Opt-in provider results retain their original price wording.
- Flight/hotel/car picks are local comparisons. They update the summary's estimated total and persist per session in localStorage. They do not update backend context or book or hold inventory.
- Running, completed, failed and needs-input states remain visible. Planning activity shows totals (specialists, searches, elapsed time) and a per-specialist timeline bar, task, plain-language tool calls with raw tool names, and the result summary. It is a debugging view, not a tracing dashboard.

## Continuity

The session ID and settled messages persist in localStorage, so a refresh resumes the same trip. The activity socket reconnects with exponential backoff (up to 8s), and a banner explains the reconnection. Every connect replays the session's events. Handlers are idempotent by event timestamp, so replays never duplicate messages or tool calls and never clear results already on screen.

## Mobile and accessibility

At 760px and below, explicit Conversation / Trip board buttons replace the desktop split. Both panes retain state while switching. The composer stays within the conversation pane. Smaller desktop heights use a more compact welcome area.

Buttons have accessible names, form fields are labeled, toggles expose pressed states, keyboard focus is visible, and reduced-motion preference disables animations/transitions. Long messages wrap. Mobile input uses 16px text. Light appearance is intentional; no dark-theme toggle is implemented.

## Verification

October 27 redesign: desktop 1440×900 and mobile 375×812 were inspected with a recorded San Juan run (four specialists) and a live Savannah run. The Savannah run produced Airbnb links only and an honestly failed itinerary. Picking options, totals, the jump bar, day tabs, planning activity, refresh resume and reconnect after an orchestrator restart were all exercised. Lint, type checks, production build and five new trip-logic unit tests passed (`apps/web/test/trip.test.ts`). Voice was not re-tested.

Earlier:

Desktop and 390×844 mobile layouts were inspected, inspiration-to-draft and pane switching were exercised, and a live Harpers Ferry request rendered a sourced itinerary. Lint, type checks, production build and the 12 deterministic backend/travel tests passed during the redesign. Voice permission failure handling was added; full voice playback was not re-benchmarked during the visual redesign.
