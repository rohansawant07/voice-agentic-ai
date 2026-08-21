/** Deterministic mock dataset — US + territories leisure destinations. */

export interface Destination {
  code: string;
  city: string;
  region: string;
  beach: boolean;
  hotels: { name: string; star: number; neighborhood: string; base: number }[];
  activities: { title: string; kind: string; cost: number }[];
}

export const CARRIERS = [
  { code: "B6", name: "JetBlue" },
  { code: "UA", name: "United" },
  { code: "DL", name: "Delta" },
  { code: "AA", name: "American" },
  { code: "NK", name: "Spirit" },
  { code: "AS", name: "Alaska" },
];

export const ORIGINS = ["JFK", "EWR", "BOS", "ATL", "ORD", "DFW", "LAX", "SFO", "SEA", "DEN", "MIA"];

export const DESTINATIONS: Destination[] = [
  {
    code: "SJU",
    city: "San Juan, Puerto Rico",
    region: "Caribbean (US territory)",
    beach: true,
    hotels: [
      { name: "La Concha Resort", star: 4.5, neighborhood: "Condado", base: 189 },
      { name: "O:LV Fifty Five", star: 4.7, neighborhood: "Condado Lagoon", base: 240 },
      { name: "Hotel El Convento", star: 4.6, neighborhood: "Old San Juan", base: 210 },
      { name: "Verdanza Hotel", star: 3.5, neighborhood: "Isla Verde", base: 120 },
      { name: "Casa Sol B&B", star: 4.2, neighborhood: "Old San Juan", base: 95 },
    ],
    activities: [
      { title: "Old San Juan walking tour", kind: "culture", cost: 25 },
      { title: "El Yunque rainforest hike", kind: "outdoors", cost: 60 },
      { title: "Bioluminescent bay kayak (Fajardo)", kind: "outdoors", cost: 65 },
      { title: "Condado beach day", kind: "beach", cost: 0 },
      { title: "Rum distillery tour", kind: "food", cost: 35 },
    ],
  },
  {
    code: "MIA",
    city: "Miami, Florida",
    region: "Southeast",
    beach: true,
    hotels: [
      { name: "The Palms South Beach", star: 4.3, neighborhood: "South Beach", base: 220 },
      { name: "Freehand Miami", star: 4.0, neighborhood: "Mid-Beach", base: 130 },
      { name: "EAST Miami", star: 4.6, neighborhood: "Brickell", base: 260 },
      { name: "Selina Gold Dust", star: 3.4, neighborhood: "MiMo", base: 90 },
    ],
    activities: [
      { title: "Art Deco district tour", kind: "culture", cost: 30 },
      { title: "Everglades airboat trip", kind: "outdoors", cost: 75 },
      { title: "Little Havana food walk", kind: "food", cost: 55 },
      { title: "South Beach day", kind: "beach", cost: 0 },
    ],
  },
  {
    code: "HNL",
    city: "Honolulu, Hawaii",
    region: "Pacific",
    beach: true,
    hotels: [
      { name: "Halekulani", star: 4.8, neighborhood: "Waikiki", base: 420 },
      { name: "Queen Kapiolani", star: 4.1, neighborhood: "Waikiki", base: 190 },
      { name: "The Surfjack", star: 4.3, neighborhood: "Waikiki", base: 230 },
    ],
    activities: [
      { title: "Diamond Head sunrise hike", kind: "outdoors", cost: 10 },
      { title: "Pearl Harbor memorial", kind: "culture", cost: 30 },
      { title: "North Shore surf lesson", kind: "outdoors", cost: 90 },
      { title: "Waikiki beach day", kind: "beach", cost: 0 },
    ],
  },
  {
    code: "MCO",
    city: "Orlando, Florida",
    region: "Southeast",
    beach: false,
    hotels: [
      { name: "Grand Bohemian", star: 4.4, neighborhood: "Downtown", base: 180 },
      { name: "Drury Plaza Disney Springs", star: 4.2, neighborhood: "Lake Buena Vista", base: 160 },
      { name: "Avanti Palms", star: 3.6, neighborhood: "International Drive", base: 95 },
    ],
    activities: [
      { title: "Theme park day (Magic Kingdom)", kind: "family", cost: 140 },
      { title: "Kennedy Space Center day trip", kind: "culture", cost: 80 },
      { title: "Wekiwa Springs kayaking", kind: "outdoors", cost: 40 },
    ],
  },
  {
    code: "DEN",
    city: "Denver, Colorado",
    region: "Mountain West",
    beach: false,
    hotels: [
      { name: "The Crawford", star: 4.6, neighborhood: "Union Station", base: 250 },
      { name: "Life House Lower Highlands", star: 4.2, neighborhood: "LoHi", base: 150 },
    ],
    activities: [
      { title: "Rocky Mountain NP day trip", kind: "outdoors", cost: 35 },
      { title: "Red Rocks concert or hike", kind: "outdoors", cost: 20 },
      { title: "RiNo street-art & brewery walk", kind: "food", cost: 45 },
    ],
  },
  {
    code: "FLG",
    city: "Sedona/Flagstaff, Arizona",
    region: "Southwest",
    beach: false,
    hotels: [
      { name: "Enchantment Resort", star: 4.7, neighborhood: "Boynton Canyon", base: 380 },
      { name: "Sky Rock Sedona", star: 4.3, neighborhood: "West Sedona", base: 200 },
    ],
    activities: [
      { title: "Cathedral Rock hike", kind: "outdoors", cost: 0 },
      { title: "Grand Canyon day trip", kind: "outdoors", cost: 55 },
      { title: "Vortex jeep tour", kind: "outdoors", cost: 95 },
      { title: "Tlaquepaque arts village + dinner", kind: "food", cost: 70 },
    ],
  },
  {
    code: "AVL",
    city: "Asheville, North Carolina",
    region: "Southeast mountains",
    beach: false,
    hotels: [
      { name: "The Foundry", star: 4.5, neighborhood: "Downtown", base: 210 },
      { name: "Zelda Dearest", star: 4.4, neighborhood: "Chestnut Hill", base: 180 },
    ],
    activities: [
      { title: "Blue Ridge Parkway drive + hikes", kind: "outdoors", cost: 0 },
      { title: "Biltmore Estate", kind: "culture", cost: 90 },
      { title: "South Slope brewery & food tour", kind: "food", cost: 60 },
    ],
  },
  {
    code: "STT",
    city: "St. Thomas, US Virgin Islands",
    region: "Caribbean (US territory)",
    beach: true,
    hotels: [
      { name: "The Ritz-Carlton St. Thomas", star: 4.7, neighborhood: "Great Bay", base: 450 },
      { name: "Bolongo Bay Beach Resort", star: 3.9, neighborhood: "Bolongo Bay", base: 220 },
    ],
    activities: [
      { title: "Magens Bay beach day", kind: "beach", cost: 5 },
      { title: "St. John / Trunk Bay ferry + snorkel", kind: "outdoors", cost: 70 },
      { title: "Charlotte Amalie old town walk", kind: "culture", cost: 0 },
    ],
  },
];

export const FARE_CLASSES = ["Basic", "Main", "Comfort+", "First"];

export function destinationByQuery(q: string): Destination | undefined {
  const needle = q.trim().toLowerCase();
  return DESTINATIONS.find(
    (d) =>
      d.code.toLowerCase() === needle ||
      d.city.toLowerCase().includes(needle) ||
      needle.includes(d.code.toLowerCase()) ||
      needle
        .split(/[\s,]+/)
        .some((w) => w.length > 3 && d.city.toLowerCase().includes(w)),
  );
}
