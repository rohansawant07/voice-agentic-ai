# Roam — Current interface

Implemented October 26, 2026. This document supersedes the early orb/swipe/dark-theme concepts; their history remains in Git.

## Product and visual direction

Roam is a conversational US travel planner. A user starts with a rough idea, discusses constraints, and reviews structured trip research. The interface must distinguish demo inventory, direct search links and sourced planning facts from verified availability or real bookings.

The visual system uses a white conversation area and a pale slate trip board, navy text and blue actions. Tokens live in `apps/web/src/app/globals.css`: background `#f3f5f8`, surface `#fff`, text `#172b45`, muted text `#68768a`, accent `#315ddd`, border `#e2e7ef`. Typography uses Avenir Next/Avenir with Segoe UI and sans-serif fallbacks. Icons are local SVG components; the inspiration photograph loads from Unsplash with a solid-color fallback.

## Desktop workspace

- Header: Roam identity and US/territories scope.
- Left pane: travel-companion status, welcome prompts or conversation, persistent composer, voice control and verification note.
- Right pane: trip board with Overview and Planning activity views.
- Empty board: scenic inspiration and direction prompts. These populate an editable draft; they do not submit requests automatically.
- After research: flights, stays, rental cars, itinerary, budget and booking sections appear for specialists with activity.
- Result grids wrap to available width instead of requiring horizontal card scrolling.

## Conversation and voice

Enter submits a nonempty draft; Shift+Enter adds a line. IME composition does not submit prematurely. Send is disabled while listening/planning. A thinking indicator appears while waiting. New messages scroll the transcript to the end; an empty welcome screen stays at the top.

The microphone button starts/stops recording; while a reply is speaking, it stops playback. Microphone permission failures produce a typed-input fallback message. Desktop Space supports push-to-talk outside interactive elements; Escape stops speech. Voice is available only when the backend reports STT enabled.

The backend transcribes after recording ends. It does not stream partial recognition. The browser buffers TTS audio until `tts_end`, then plays. Interrupting speech does not abort the entire model/tool request.

## Trip results and provenance

- Itineraries use a vertical sequence of stops with time-of-day labels and descriptions.
- Sources and planning notes are expandable alongside the itinerary.
- Airbnb links are explicitly labeled as search links with unverified listings/prices. Opt-in provider results retain their original price wording.
- Flight/hotel/car selections are local visual comparisons only. They do not update backend context, book inventory or recompute the budget.
- Running, completed, failed and needs-input states remain visible. Planning activity exposes specialist tasks and tool activity for debugging; it is not a tracing dashboard.

## Mobile and accessibility

At 760px and below, explicit Conversation / Trip board buttons replace the desktop split. Both panes retain state while switching. The composer stays within the conversation pane. Smaller desktop heights use a more compact welcome area.

Buttons have accessible names, form fields are labeled, toggles expose pressed states, keyboard focus is visible, and reduced-motion preference disables animations/transitions. Long messages wrap. Mobile input uses 16px text. Light appearance is intentional; no dark-theme toggle is implemented.

## Verification

Desktop and 390×844 mobile layouts were inspected, inspiration-to-draft and pane switching were exercised, and a live Harpers Ferry request rendered a sourced itinerary. Lint, type checks, production build and the 12 deterministic backend/travel tests passed during the redesign. Voice permission failure handling was added; full voice playback was not re-benchmarked during the visual redesign.
