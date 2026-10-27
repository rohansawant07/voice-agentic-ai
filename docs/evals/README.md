# Itinerary grounding eval (M3)

Checks that the itinerary specialist grounds its days in the guide listings or web-search evidence it received, and describes each stop only with supported facts (AGENTS.md: visible provenance, no invented facts).

## What a run does

For each golden case in [`services/orchestrator/eval/itinerary.ts`](../../services/orchestrator/eval/itinerary.ts):

1. Runs the real itinerary specialist (`runSpecialist` with the registry prompt, `claude-haiku-4-5`) against live MCP servers: Wikivoyage or curated NPS guides, mock activity inventory and Open-Meteo weather.
2. Captures every `get_destination_guide`, `search_activities` and `search_web` result it received, plus weather results for context.
3. Deterministic checks in code:
   - every stop is scheduled on the expected number of days;
   - no stop is a listing from `closedDuringTrip`;
   - for Wikivoyage guides, every stop title exactly matches a listing title (case and punctuation ignored). This is relaxed when `search_web` returned evidence, because the prompt allows web-backed extra stops; the judge still checks those stops.
4. A judge (`claude-sonnet-5`) reads the trip request, the tool results and the days. It flags stop titles not in the listings (`unlisted_title`), and descriptive claims the listing fields don't support (`unsupported_claim`). Examples: "indoor", "year-round", "good for groups", prices, hours.

A case passes only if the specialist returned `ok`, the code checks pass and the judge reports no findings. Two judge calibration fixtures run first, using real Lake George listings with hand-written days:

- **`judge-flags-known-embellishments`**: must flag "indoor-friendly" mini-golf and "cozy indoor stop", and must not flag a correct paraphrase.
- **`judge-accepts-grounded-text`**: must report nothing.

If either fails, the case verdicts are not trustworthy and the script exits 1.

| Case | Guide source | Why it's here |
|---|---|---|
| `lake-george-thanksgiving` | Wikivoyage | Original failure. Off-season closures, six travelers; earlier runs added "indoor-friendly" mini-golf and "cozy indoor stop" |
| `savannah-april` | Wikivoyage | In-season city with many food listings |
| `harpers-ferry-weekend` | Curated NPS | Curated guide with titles only and no descriptions |
| `san-juan-december` | Mock inventory + Wikivoyage | Territory; the mock catalog includes costs and Wikivoyage listings do not |

## Running it

It makes paid model calls, so it is **not** part of `pnpm test` or CI. CI only typechecks the eval (`tsconfig.eval.json`).

```bash
pnpm install && pnpm --filter @concierge/core --filter @concierge/mcp-kit build
node scripts/eval-itinerary.mjs                      # all cases, reads ./.env
node scripts/eval-itinerary.mjs --case savannah-april --env /path/to/.env --output /tmp/out.json
```

The script starts its own MCP servers on ports 8111–8113, so a running dev stack is unaffected. It prints PASS/FAIL per case with each finding. It writes the full raw record (tool calls, specialist output, judge verdict, token usage and cost) to `docs/evals/itinerary-<date>.json`, and exits 1 if any case fails. `JUDGE_MODEL` and `SPECIALIST_MODEL` override the models.

## Cost

Measured on October 27, 2026, at uncached list prices: Haiku 4.5 $1/$5 and Sonnet 5 $2/$10 per million input/output tokens.

| Run | Code | Specialist (Haiku) | Judge (Sonnet) | Calibration | Total | Wall time |
|---|---|---|---|---|---|---|
| [61514fe run 1](itinerary-2026-10-27-61514fe-run1.json) | before web search; no calibration yet | $0.088 | $0.154 | n/a | $0.24 | 2.7 min |
| [61514fe run 2](itinerary-2026-10-27-61514fe-run2.json) | before web search | $0.098 | $0.181 | $0.015 | $0.29 | 3.6 min |
| [before guard](itinerary-2026-10-27.json) | `1bd5079` (web search) + this eval | $0.087 | $0.167 | $0.016 | $0.27 | 3.5 min |
| [with guard](itinerary-2026-10-27-guarded.json) | `1b38139` + itinerary guard | $0.143 | $0.154 | $0.015 | $0.31 | 3.3 min |
| [with generated descriptions](itinerary-2026-10-27-described.json) | `48cc520` | $0.127 | $0.132 | $0.016 | $0.27 | 3.1 min |
| [scoped tools + focused prompts](itinerary-2026-10-27-scoped.json) | this change, Haiku 4.5 | $0.083 | $0.105 | $0.015 | **$0.20** | 2.3 min |
| [same, on Haiku 5.5](itinerary-2026-10-27-haiku-5-5.json) | this change, `SPECIALIST_MODEL=claude-haiku-5-5` | **$0.012** | $0.075 | skipped | **$0.09** | 1.7 min |

Budget **about $0.25–0.35 per full run**. Other notes:

- About 60% of the spend is the judge, which reads every listing.
- `--case <id>` runs one case for about $0.05–0.13. `--skip-calibration` skips about $0.015.
- **Not counted in `totalCostUSD`:**
  - `search_web` calls are separate Haiku research requests plus Anthropic's web-search fee. The record counts them and estimates about $0.03 each. The specialist made none in the current run.
  - A specialist call that throws (for example a schema mismatch) records $0, though its tokens were billed.
- Developing this eval, the guard and the prompt changes cost about $1.94 in total: seven committed runs plus one discarded run made before the judge saw the trip request. Two attempts stopped on an empty credit balance and cost nothing.
- Haiku 5.5 is priced at $0.10/$0.50 per million tokens (prompts under 100K). The eval's price table includes it.

Each run is one sample per case, taken from live, changing sources (Wikivoyage edits, forecasts, the web) and a sampled model. Treat a pass as "no problem seen this run", not a guarantee.

## Results (October 27, 2026)

Both calibration fixtures passed in every run where they ran. **With scoped tools and focused prompts: 3/4 on Haiku 4.5 and 4/4 on Haiku 5.5.** Earlier runs passed 0/4, then 1/4.

### Scoped tools and focused prompts

Each specialist now gets only its allowlisted MCP tools (`tools` in `packages/core/src/registry.ts`), plus `search_web`. Before, every specialist saw every tool on its server: the flight agent saw hotel, car and currency tools. The six prompts were rewritten as short, task-specific briefs.

The itinerary prompt now tells Haiku what the guard enforces:

- one day per trip date;
- each stop is exactly one listing;
- no merged or generic stops;
- describe a stop only with words from its own listing.

An offline test checks every allowlisted name against the tools its servers register, and that only the flight and support agents hold destructive tools.

| Measure | Generated descriptions (old prompts, all tools) | Scoped + focused, Haiku 4.5 | Scoped + focused, Haiku 5.5 |
|---|---|---|---|
| Cases passed | 1/4 | **3/4** | **4/4** |
| Judge findings per stop | 0.30 (7 / 23) | 0.13 (4 / 30) | **0** (0 / 29) |
| Stops the guard removed | 9 | 0 | 0 |
| Lake George days | 2 of 3 | 3 of 3 | 3 of 3 |
| Specialist input / output tokens | 82,070 / 8,983 | 58,591 / 4,909 | 50,549 / 14,226 |
| Specialist cost, 4 itineraries | $0.127 | $0.083 | **$0.012** |

Notes:

- The only remaining findings are Savannah's, on Haiku 4.5 (4 findings).
- Haiku 5.5 writes more output tokens, because its adaptive thinking is on by default. It is still about 7× cheaper than Haiku 4.5 per itinerary.
- **These are single samples, and the eval covers only the itinerary specialist.** The flight, stays, car, budget and support specialists have no eval. Their prompt changes and a Haiku 5.5 switch are untested on live traffic.

### Generated descriptions for title-only listings

Listings with no description of their own carry only a title, a kind and sometimes an address, hours or price. These are NPS guide entries, Roam's demo activity list, and Wikivoyage entries with only an address or website. The guard now writes their stop description from those fields plus a provenance caveat, for example: "Cultural visit from the National Park Service planning guide. Confirm current access and hours with NPS." Model wording is kept only where the listing has its own description. The judge accepts the two new caveats.

| Measure | With guard | With generated descriptions |
|---|---|---|
| Cases passed | 0/4 | **1/4** (Harpers Ferry) |
| Judge findings per stop | 0.52 (16 / 31) | **0.30** (7 / 23) |
| Harpers Ferry / San Juan findings | 8 / 4 | **0** / 2 |
| Stop titles not in listings | 0 | 0 |
| Stops the guard removed | 5 | 9 |
| Days | 2 of 3 Lake George; others complete | Same |

What remains:

- **Wording on listings with their own text.** Haiku still embellishes Wikivoyage listings: "historic square", "a unique group experience", "upscale" for a restaurant described as romantic.
- **Facts borrowed from another listing.** The "27 acres" figure belongs to El Castillo de San Cristóbal but was attributed to the San Juan National Historic Site.
- **Thinner plans.** Haiku keeps proposing merged or generic stops ("Mini-Golf Competition", "Casa Blanca and La Casa del Libro"), and the guard removes them. Lake George again lost its third day, and San Juan has 6 stops over 3 days.
- **Plain, repetitive descriptions** on NPS entries. That is the intended trade.

These are one sample per run.

### Itinerary guard

`services/orchestrator/src/itinerary-guard.ts` runs on every `ok` itinerary result. It:

- Renames a retitled stop to its listing title. A stop maps to a listing when its title matches exactly, or contains exactly one listing title ("La Bombonera dinner" becomes "La Bombonera").
- Removes merged, invented and closed stops, unless `search_web` evidence exists; closed places are always removed.
- Drops a `mealPick` that names no listing, and drops days left without sourced stops.
- Keeps days inside the trip dates (context `startDate`/`endDate`, else the forecast arguments) and removes duplicate or extra days.
- Records every removal in `notes`.
- Rejects an `ok` result that has neither days nor destinations as `failed` (`missing_itinerary_days`).

Five offline tests cover it in `test/itinerary-guard.test.ts`.

| Measure | Before guard (`1bd5079`) | With guard (`1b38139`) |
|---|---|---|
| Cases passed | 0/4 | 0/4 |
| Stop titles not in listings | 14 | **0** |
| Wrong day count | 1 (4 days for Dec 4–6) | 1 (Lake George: a day of invented stops was removed, leaving 2 of 3) |
| Specialist returned no plan | 1 (Savannah schema failure) | 0 |
| Judge findings per stop | 0.69 (18 / 26) | **0.52** (16 / 31) |

Every remaining failure is description embellishment the code can't remove:

- "a fun group activity" for Gooney Golf.
- "$10 per adult" for a bare "$10".
- Civil War history and river names added to title-only NPS entries.
- "upscale" for a restaurant described only as romantic.

The guard does not fix specialist calls that throw (the earlier Savannah schema mismatch) or a plan with too few sourced days. These are one sample each; the Savannah improvement may be variance.

### Runs before the guard

Judge findings per stop: 0.39, 0.76 and 0.69.

| Case | 61514fe run 1 | 61514fe run 2 | `1bd5079` |
|---|---|---|---|
| Lake George | 3 days. "Lake George Steamboat Company Cruise"; "more upscale" for "more expensive" | **Specialist `failed`**, citing unavailable weather, against the prompt | 3 days, with 3 of 9 stops invented or merged ("Arrival & Scenic Drive", "Pirate's Cove Adventure Golf or Gooney Golf"); "family-friendly", "exhilarating" |
| Savannah | "iconic", "romantic", "historically rich" | Merged "River Street & Plant Riverside District"; "Adults $10" for a bare "$10" | **Specialist `failed`** (output did not match schema). A discarded run returned `ok` with a 3-day summary and **no days** |
| Harpers Ferry | History added to title-only NPS entries ("1859 raid", "rewarding at sunset") | Named rivers; "guided or self-guided"; invented "outdoor exploration" stop | Invented "Hiking and scenic trails" stop; "reconstructed building", "1862 Battle" |
| San Juan | Five retitled stops ("La Bombonera dinner", "Casa Blanca museum") | Eight retitled stops; "Open daily" added to hours | **4 days for a Dec 4–6 trip**; 10 generic stops ("Dinner with ambiance"); "pastel-colored buildings", "golden sand" |

What these runs showed (items 1 and 3 led to the guard):

1. **Retitling and invented stops.** Haiku appends words to listing titles, merges two listings into one stop, or adds generic stops ("Dinner at a local restaurant"). The code check catches all of these; enforcing exact titles in code (as is done for closures) would remove the class.
2. **Embellishment.** Descriptions add world knowledge and tone, worst on curated NPS entries and mock inventory, which have titles but no descriptions. The judge catches it.
3. **Envelope reliability.**
   - One specialist returned `failed` over weather, against the prompt.
   - One threw on a schema mismatch.
   - One returned `ok` with no `days`. The existing guard only catches `data == null`, so the trip board would show a summary with no plan.
   - One produced the wrong number of days.
4. **No web research.** The itinerary specialist never called `search_web` in these cases, so its new web-backed-stop allowance went unused.

The judge is strict by design: "Adults $10" and "Open daily" count as unsupported. Read the findings, not only the pass count, and compare `judgeFindingsPerStop` across runs.

## Web-search verification versus itinerary quality

The separate October 27 authenticated application smoke test explicitly requested web research and successfully invoked itinerary-agent → `search_web`, returned official NPS operating hours, and persisted ten source links. That proves the tool path works; it does not supersede the 0/4 itinerary results above. Search uses Anthropic's native `web_search_20250305` with the existing Anthropic key, not Deepgram. No new paid evaluation was run for this README refresh; the committed result files remain historical evidence.
