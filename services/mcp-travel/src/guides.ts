/** Curated planning facts, independent of the mock booking catalog. */
export const GUIDES = [
  {
    destination: "Harpers Ferry, West Virginia",
    aliases: ["harpers ferry", "harper's ferry"],
    weatherPlace: "Harpers Ferry",
    sourceUrl: "https://www.nps.gov/hafe/planyourvisit/placestogo.htm",
    note: "Planning guide, not bookable inventory. Confirm current access, fees, and trail conditions with NPS. No restaurant or dietary claims are verified.",
    activities: [
      { title: "Lower Town historic district and John Brown's Fort", kind: "culture" },
      { title: "The Point river-confluence viewpoint", kind: "outdoors" },
      { title: "Bolivar Heights battlefield walk", kind: "culture" },
      { title: "Visitor Center orientation and shuttle to Lower Town", kind: "culture" },
    ],
  },
  {
    destination: "Shenandoah Valley, Virginia",
    aliases: ["shenandoah valley", "shenandoah national park", "shenandoah", "luray", "front royal"],
    weatherPlace: "Luray",
    sourceUrl: "https://www.nps.gov/shen/planyourvisit/things2do.htm",
    note: "This guide covers Shenandoah National Park near the valley, not every valley town. Luray is a weather reference only; mountain conditions differ. Confirm road access, fees, trails, and programs with NPS. No restaurant or dietary claims are verified.",
    activities: [
      { title: "Skyline Drive scenic overlooks", kind: "outdoors" },
      { title: "Shenandoah National Park hiking", kind: "outdoors" },
      { title: "Park exhibits", kind: "culture" },
      { title: "Ranger programs (check current schedule)", kind: "culture" },
    ],
  },
];

export function guideFor(destination: string) {
  const query = destination.toLowerCase().replace(/[’]/g, "'");
  return GUIDES.find((guide) => guide.aliases.some((alias) => query.includes(alias)));
}

export function destinationGuide(destination: string) {
  const guide = guideFor(destination);
  if (!guide) return {
    destination, activities: [], source: "unavailable",
    note: "No verified guide for this destination yet. This is a data coverage gap, not an agency restriction. Lodging search can still be used; do not invent activities.",
  };
  return { ...guide, source: "curated-official-guide", pricesVerified: false };
}
