import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlace, pickByRegion } from "@concierge/mcp-kit";
import {
  chooseTitle,
  cleanWikitext,
  forTripMonth,
  inUS,
  openInMonth,
  parseListings,
  wikivoyageGuide,
} from "../src/wikivoyage.js";

const PAGE = `{{pagebanner|Lake George.jpg}}
Lake George is in [[New York (state)|New York]]. {{geo|43.42|-73.71}}
==See==
* {{see
| name=Fort William Henry Museum | url=https://www.fwhmuseum.com/ | address=48 Canada St
| lat=43.41 | long=-73.71 | hours=May-Oct: daily 9:30AM-5:30PM; closed Nov-Apr | price=Adults $20
| lastedit=2021-06-28
| content=A '''replica''' of the [[French and Indian War|1750s]] fort {{km|1}}, with [http://x.org reenactments].
}}
* {{see | name=Prospect Mountain | content=Drive to the summit for views. }}
==Do==
* {{do | name=Lake cruise | url=http://insecure.example | content=Steamboat tours, seasonal. }}
==Eat==
* {{eat | name=Diner | address=1 Main St | content=Breakfast all day. }}
* {{sleep | name=Ignored Inn | content=Lodging is the stays specialist's job. }}
`;

function fakeWikivoyage(pages: Record<string, string>, titles: string[]): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.searchParams.get("list") === "search")
      return Response.json({ query: { search: titles.map((title) => ({ title })) } });
    const title = url.searchParams.get("page")!;
    return Response.json({ parse: { title, wikitext: pages[title] ?? "" } });
  }) as typeof fetch;
}

test("places parse states, territories and US suffixes", () => {
  assert.deepEqual(parsePlace("Lake George, NY"), { name: "Lake George", region: "New York", country: "US" });
  assert.deepEqual(parsePlace("Paris, Texas, USA"), { name: "Paris", region: "Texas", country: "US" });
  assert.deepEqual(parsePlace("San Juan, Puerto Rico"), { name: "San Juan", region: "Puerto Rico", country: "PR" });
  assert.equal(parsePlace("St. Thomas").country, "VI");
  assert.deepEqual(parsePlace("Savannah"), { name: "Savannah", region: undefined, country: "US" });
});

test("geocoder results must match a requested state", () => {
  const hits = [{ admin1: "Minnesota" }, { admin1: "New York" }];
  assert.equal(pickByRegion(hits, "New York"), hits[1]);
  assert.equal(pickByRegion(hits, "Texas"), undefined);
  assert.equal(pickByRegion(hits, undefined), hits[0]);
});

test("titles match the locality and any state qualifier", () => {
  const titles = ["Paris", "Paris (Texas)", "Paris (Tennessee)", "New York (state)"];
  assert.equal(chooseTitle(titles, "Paris, TX"), "Paris (Texas)");
  assert.equal(chooseTitle(titles, "Paris"), "Paris");
  assert.equal(chooseTitle(["Lake George", "Adirondacks"], "Lake George, NY"), "Lake George");
  assert.equal(chooseTitle(["Lake Placid"], "Lake George, NY"), undefined);
});

test("listings parse nested markup and drop lodging and insecure links", () => {
  const listings = parseListings(PAGE);
  assert.deepEqual(listings.map((l) => [l.title, l.kind]), [
    ["Fort William Henry Museum", "sight"],
    ["Prospect Mountain", "sight"],
    ["Lake cruise", "activity"],
    ["Diner", "food"],
  ]);
  const fort = listings[0]!;
  assert.equal(fort.description, "A replica of the 1750s fort, with reenactments.");
  assert.equal(fort.hours, "May-Oct: daily 9:30AM-5:30PM; closed Nov-Apr");
  assert.equal(fort.listedPrice, "Adults $20");
  assert.equal(fort.website, "https://www.fwhmuseum.com/");
  assert.equal(fort.lastEdited, "2021-06-28");
  assert.equal(listings[2]!.website, undefined);
  assert.equal(cleanWikitext("[[A|B]] and [[C]] '''bold''' {{x|y}}"), "B and C bold");
});

test("community guides are sourced, unpriced and US-only", async () => {
  const guide = await wikivoyageGuide(
    "Lake George, NY",
    fakeWikivoyage({ "Lake George": PAGE }, ["Lake George"]),
  );
  assert.ok(guide);
  assert.equal(guide.source, "wikivoyage");
  assert.equal(guide.pricesVerified, false);
  assert.equal(guide.sourceUrl, "https://en.wikivoyage.org/wiki/Lake_George");
  assert.equal(guide.weatherPlace, "Lake George, New York");
  assert.equal(guide.activities.length, 4);

  const minnesota = await wikivoyageGuide(
    "Lake George, MN",
    fakeWikivoyage({ "Lake George": PAGE }, ["Lake George"]),
  );
  assert.equal(minnesota, null, "a same-named page in another state is rejected");

  const france = PAGE.replace("{{geo|43.42|-73.71}}", "{{geo|48.85|2.35}}");
  assert.equal(
    await wikivoyageGuide("Lake George", fakeWikivoyage({ "Lake George": france }, ["Lake George"])),
    null,
    "pages outside the US are rejected",
  );
  assert.equal(
    await wikivoyageGuide("Springfield", fakeWikivoyage({ Springfield: "{{disamb}} {{geo|39.8|-89.6}}" + PAGE }, ["Springfield"])),
    null,
    "disambiguation pages are rejected",
  );
  assert.ok(inUS(18.47, -66.1) && inUS(13.44, 144.79) && !inUS(51.5, -0.12));
});

test("listing seasons decide closures without model judgment", async () => {
  const nov = 11;
  assert.equal(openInMonth({ hours: "May-Oct: daily 9:30AM-5:30PM; closed Nov-Apr" }, nov), false);
  assert.equal(openInMonth({ hours: "closed Nov-Apr" }, 7), true);
  assert.equal(openInMonth({ hours: "open May-Oct" }, nov), false);
  assert.equal(openInMonth({ description: "Steak and wings. Open April-October, free WiFi." }, nov), false);
  assert.equal(openInMonth({ hours: "Dec to Mar" }, 1), true, "ranges wrap the new year");
  assert.equal(openInMonth({ hours: "Noon-8PM", description: "Mario's since 1954" }, nov), undefined);

  const guide = await wikivoyageGuide(
    "Lake George, NY",
    fakeWikivoyage({ "Lake George": PAGE }, ["Lake George"]),
  );
  const november = forTripMonth(guide!, nov) as ReturnType<typeof forTripMonth> & { closedDuringTrip: string[] };
  assert.deepEqual(november.closedDuringTrip, ["Fort William Henry Museum"]);
  assert.ok(november.activities.every((a) => "seasonUnconfirmed" in a));
  const july = forTripMonth(guide!, 7);
  assert.equal(july.activities[0]!.title, "Fort William Henry Museum");
  assert.ok(!("seasonUnconfirmed" in july.activities[0]!));
  assert.equal(forTripMonth(guide!, undefined), guide);
});
