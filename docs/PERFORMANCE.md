# Roam — Measured performance

Measured October 26, 2026 on a local macOS ARM64 machine, using Node v23.11.0 and the running Next.js development server. The benchmark used one request at a time, already-running services, and a fresh session for each model request. Source revision before this documentation pass: `83ae89f`.

## Text requests

| Scenario | Runs / HTTP 200 | Median complete reply | Sample p95 | First delegation, median | First successful specialist result, median |
| --- | --- | --- | --- | --- | --- |
| clarification | 3/3 | 2.33s | 2.96s | — | — |
| regional-itinerary | 3/3 | 17.21s | 20.74s | 3.03s | 14.33s |
| multi-specialist | 3/3 | 38.10s | 46.33s | 6.94s | 15.54s |

With only **three samples per scenario**, nearest-rank p95 is the slowest observed sample. It is not a reliable population tail estimate. These figures are neither a production SLA nor a concurrency/capacity test.

All nine text requests returned HTTP 200. There were 13 specialist attempts: 12 returned `ok`, one itinerary attempt failed and was retried successfully within the same multi-specialist turn. Eight of nine requests had no failed specialist attempts. The failed attempt’s reason is not exposed by the activity event and was not inferred. HTTP success alone would have hidden that retry.

| Scenario | Individual complete-reply samples |
| --- | --- |
| clarification | 2.33s, 2.96s, 1.42s |
| regional-itinerary | 20.74s, 17.21s, 16.19s |
| multi-specialist | 35.39s, 46.33s, 38.10s |

## Voice-input path

Three runs used a **5.392-second synthetic PCM WAV** through the real `/voice` socket. Timing starts when `audio_end` is sent, after queueing the complete fixture on the socket; it excludes recording time but can include remaining transport time. Deepgram STT was enabled and TTS was disabled in the running server.

| Metric | n | Median | Sample p95 |
| --- | --- | --- | --- |
| End of upload → transcript | 3 | 0.26s | 0.78s |
| End of upload → final text reply | 3 | 1.37s | 2.22s |

These are client-observed pipeline times, not isolated Deepgram service times. The voice prompt asks only for a clarifying question; it is not comparable to a multi-specialist research turn. The same synthetic clip was reused; accents, background noise, mobile networks and natural turn-taking were not evaluated. No private microphone audio was captured.

**Time to first audible reply is unmeasured.** TTS is currently off. Even when enabled, the browser accumulates audio until `tts_end`; server-side chunking does not mean early browser playback. The old “≤2 seconds to first spoken token” claim was an aspiration, not evidence.

## HTTP service probes

Twenty sequential samples per endpoint after one excluded warm-up request. Measurements include reading the response body over loopback. The web measurement fetches HTML; it is not browser rendering, LCP, or a production frontend score.

| Endpoint | Median | Sample p95 |
| --- | --- | --- |
| web / | 24.91 ms | 37.26 ms |
| orchestrator /healthz | 0.38 ms | 0.95 ms |
| travel /healthz | 0.29 ms | 1.15 ms |
| weather /healthz | 0.33 ms | 0.67 ms |
| agency /healthz | 0.40 ms | 2.95 ms |

## Interpretation

- Local liveness handlers are sub-millisecond at the median, but trip planning takes tens of seconds. Model routing/research/synthesis dominates the observed request timeline; this benchmark does not isolate each model step or MCP/network duration.
- The multi-specialist request begins delegation around seven seconds in and exposes its first successful result around sixteen seconds in. The UI can show activity and partial completed sections before the final response.
- Specialist retries can increase latency. One recovered itinerary failure occurred in the slowest multi-specialist run.
- Different scenario contents produce different output lengths and tool work. Do not pool these into a single “average latency” without a representative traffic mix.
- There is no evidence for a cache-hit ratio, per-request token cost, maximum concurrent users, uptime, or a production p95. Those require additional instrumentation and load tests.

## Method and reproduction

Source defaults are `claude-opus-4-8` for the orchestrator and `claude-haiku-4-5` for specialists; the root environment had no model overrides. The runtime API does not report model identity. Travel inventory was mock, Airbnb mode was links, and weather used its live default. Full prompts and per-event timings are saved with the raw data. No API keys or private user messages are recorded.

```bash
node scripts/benchmark.mjs --output docs/benchmarks/latest.json
# Paid model calls: three requests for each of three scenarios
node scripts/benchmark.mjs --live --runs 3 --output docs/benchmarks/latest.json

# Paid STT + model calls; supply only synthetic/consented audio
node scripts/benchmark-voice.mjs --audio /path/to/fixture.wav --runs 3 \
  --output docs/benchmarks/voice-latest.json
```

On macOS, the synthetic fixture used in this run can be generated with:

```bash
say --file-format=WAVE --data-format=LEI16@16000 -r 180 \
  -o /tmp/roam-benchmark-voice.wav \
  'I want to plan a trip in the United States. Please ask me one short question about where I want to go.'
```

Text complete-reply timing spans HTTP request start through JSON response completion. Activity timestamps are measured at the benchmark WebSocket client. First result means the first `delegation_finished` with status `ok`, not the first browser paint. Both scripts use 180-second live-request timeouts. A client timeout is not guaranteed to cancel server/model work. The voice script stops at the text reply and does not benchmark optional TTS.

- [Raw text / HTTP samples](benchmarks/2026-10-26-local.json)
- [Raw synthetic voice samples](benchmarks/2026-10-26-voice.json)

There is currently no always-on metrics endpoint, distributed trace exporter, Langfuse setup, provider usage/cost capture, or persisted metric store. This report is a point-in-time benchmark, not continuous monitoring.
