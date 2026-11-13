/** Places API helpers for the MapLibre explore map (not the survey). */

export const FILTERS = [
  ["parking", "Lots"],
  ["trailhead", "Trailhead"],
  ["hike", "Hike"],
  ["bike", "Bike"],
  ["ski", "Snow"],
  ["climb", "Climb"],
  ["foot", "Walk"],
  ["camp", "Camp"],
  ["shelter", "Shelter"],
  ["peak", "Peak"],
  ["range", "Range"],
  ["viewpoint", "Viewpoint"],
  ["beach", "Beach"],
  ["picnic", "Picnic"],
  ["hot_spring", "Hot spring"],
  ["lift", "Lift"],
  ["ranger", "Ranger"],
  ["boat", "Boat"],
  ["horse", "Horse"],
  ["hut", "Hut"],
  ["cave", "Cave"],
];

/** Pin/pill fills — trailhead + hike match survey greens. */
export const KIND_COLOR = {
  parking: "#1d4ed8",
  trailhead: "#1f6b4a",
  hike: "#0b7a56",
  bike: "#0e7490",
  ski: "#2563eb",
  climb: "#a21caf",
  foot: "#ca8a04",
  camp: "#b45309",
  shelter: "#78716c",
  peak: "#9f1239",
  range: "#9a3412",
  viewpoint: "#0891b2",
  beach: "#0284c7",
  picnic: "#65a30d",
  hot_spring: "#dc2626",
  lift: "#475569",
  ranger: "#334155",
  boat: "#1d4ed8",
  horse: "#a16207",
  hut: "#854d0e",
  cave: "#44403c",
};

/** Survey selection highlight (not “bigger pin”). */
export const SELECTED_FILL = "#a34e22";

export function defaultFilters() {
  const filters = {};
  for (const [id] of FILTERS) {
    filters[id] = id === "parking" || id === "trailhead";
  }
  return filters;
}

/** Map a search choice to a filter id (activity / pin kind). */
export function filterIdForChoice(choice) {
  if (!choice) return null;
  if (choice.kind === "pin" && choice.pin?.kind) return choice.pin.kind;
  if (choice.kind === "trail") return "hike";
  if (choice.kind === "peak") return "peak";
  if (choice.kind === "place" && choice.placeType) return choice.placeType;
  const detail = String(choice.detail || "").toLowerCase();
  for (const [id, label] of FILTERS) {
    if (detail === label.toLowerCase()) return id;
  }
  return null;
}

export function kindLabel(kind) {
  for (const [id, label] of FILTERS) {
    if (id === kind) return label;
  }
  return kind || "Place";
}

export async function searchPlaces(q, lat, lon) {
  const params = new URLSearchParams({
    q,
    lat: String(lat),
    lon: String(lon),
  });
  const res = await fetch(`/api/v1/map/search?${params}`);
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
  const data = await res.json();
  return data.choices || [];
}

export async function fetchExplorePlaces(box) {
  const params = new URLSearchParams({
    south: String(box.south),
    west: String(box.west),
    north: String(box.north),
    east: String(box.east),
  });
  const res = await fetch(`/api/v1/map/explore?${params}`);
  if (!res.ok) throw new Error(`Map HTTP ${res.status}`);
  return res.json();
}

/** Nearby lots/places for a search hit (pins even in a wide radius). */
export async function fetchNearbyPlaces(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
  const res = await fetch(`/api/v1/map/near?${params}`);
  if (!res.ok) throw new Error(`Near HTTP ${res.status}`);
  return res.json();
}

export function placeFeatureKey(pin) {
  if (!pin) return "";
  if (pin.osm_type && pin.osm_id != null && String(pin.osm_id) !== "") {
    return `${pin.osm_type}:${pin.osm_id}`;
  }
  if (pin.lat != null && pin.lon != null) {
    return `coord:${Number(pin.lat).toFixed(5)},${Number(pin.lon).toFixed(5)}`;
  }
  return "";
}

/** Survey-style title: named place, or “Lot near {trail}” for unnamed parking. */
export function displayNameForPin(pin) {
  if (!pin) return "Place";
  const kind = pin.kind || "parking";
  const name = String(pin.name || "").trim();
  if (name) return name;
  const near = String(pin.near_trail || "").trim();
  if (kind === "parking" && near) return `Lot near ${near}`;
  if (kind === "trailhead" && near) return near;
  return kindLabel(kind);
}

function pinProps(pin, selectedKey) {
  const known = pin.known || {};
  const facts = pin.facts || {};
  let toilets = "";
  if (known.bathroomExists === "no") toilets = "0";
  else if (facts.toilets) toilets = String(facts.toilets);
  let fee = "";
  if (known.payRequired === "no") fee = "no";
  else if (facts.fee) fee = String(facts.fee);
  const kind = pin.kind || "parking";
  const key = placeFeatureKey(pin);
  return {
    kind,
    name: displayNameForPin(pin),
    near_trail: pin.near_trail || "",
    osm_type: pin.osm_type || "",
    osm_id: String(pin.osm_id ?? ""),
    toilets,
    fee,
    role: "place",
    selected: selectedKey && key === selectedKey ? "yes" : "no",
  };
}

export function placesToGeoJSON(places, filters, selectedKey = null) {
  const features = [];
  for (const pin of places || []) {
    if (pin.lat == null || pin.lon == null) continue;
    const kind = pin.kind;
    if (!kind || !filters[kind]) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
      properties: pinProps(pin, selectedKey),
    });
  }
  return { type: "FeatureCollection", features };
}

/** Match a search choice to a loaded pin (for selection highlight). */
export function matchPlaceKey(choice, places) {
  if (!choice || !places?.length) return "";
  if (choice.kind === "pin" && choice.pin) return placeFeatureKey(choice.pin);
  const want = filterIdForChoice(choice);
  let best = null;
  let bestD = 0.004; // ~400m
  for (const pin of places) {
    if (want && pin.kind !== want) continue;
    const d = Math.hypot(pin.lat - choice.lat, pin.lon - choice.lon);
    if (d < bestD) {
      bestD = d;
      best = pin;
    }
  }
  return best ? placeFeatureKey(best) : placeFeatureKey({
    lat: choice.lat,
    lon: choice.lon,
  });
}

/**
 * Merge clusters that sit on top of each other in screen space
 * (backs up server grid so large bubbles don’t cover neighbors).
 */
export function mergeClustersByScreen(clusters, project, minPx = 52) {
  if (!project || !clusters?.length) return clusters || [];
  const ordered = [...clusters]
    .filter((c) => c.lat != null && c.lon != null)
    .map((c) => ({
      lat: c.lat,
      lon: c.lon,
      count: Number(c.count) || 0,
      south: c.south,
      west: c.west,
      north: c.north,
      east: c.east,
      pt: project([c.lon, c.lat]),
    }))
    .sort((a, b) => b.count - a.count);
  const kept = [];
  for (const cell of ordered) {
    let absorbed = false;
    for (const other of kept) {
      const dx = cell.pt.x - other.pt.x;
      const dy = cell.pt.y - other.pt.y;
      if (Math.hypot(dx, dy) < minPx) {
        other.count += cell.count;
        if (cell.south != null) {
          other.south = Math.min(other.south ?? cell.south, cell.south);
          other.west = Math.min(other.west ?? cell.west, cell.west);
          other.north = Math.max(other.north ?? cell.north, cell.north);
          other.east = Math.max(other.east ?? cell.east, cell.east);
        }
        absorbed = true;
        break;
      }
    }
    if (!absorbed) kept.push(cell);
  }
  return kept.map(({ lat, lon, count, south, west, north, east }) => ({
    lat,
    lon,
    count,
    south,
    west,
    north,
    east,
  }));
}

export function clustersToGeoJSON(clusters) {
  const features = [];
  for (const cell of clusters || []) {
    if (cell.lat == null || cell.lon == null) continue;
    const props = {
      role: "cluster",
      count: Number(cell.count) || 0,
      name: String(cell.count || ""),
    };
    if (
      cell.south != null
      && cell.west != null
      && cell.north != null
      && cell.east != null
    ) {
      props.south = Number(cell.south);
      props.west = Number(cell.west);
      props.north = Number(cell.north);
      props.east = Number(cell.east);
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cell.lon, cell.lat] },
      properties: props,
    });
  }
  return { type: "FeatureCollection", features };
}

export function parseCoordinates(text) {
  const m = String(text || "")
    .trim()
    .match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lon: a };
  return null;
}

export function choiceSubtitle(choice) {
  const bits = [choice.detail, choice.where].filter(Boolean);
  return bits.join(" · ");
}

export function choiceToSheetProps(choice) {
  if (choice.kind === "pin" && choice.pin) {
    const pin = choice.pin;
    const known = pin.known || {};
    const facts = pin.facts || {};
    return {
      kind: pin.kind,
      name: displayNameForPin(pin) || choice.label,
      fee: known.payRequired === "no" ? "no" : (facts.fee || pin.fee || ""),
      toilets:
        known.bathroomExists === "no"
          ? "0"
          : facts.toilets != null
            ? String(facts.toilets)
            : "",
    };
  }
  const kind = filterIdForChoice(choice) || "place";
  return {
    kind,
    name: choice.label || kindLabel(kind),
    fee: "",
    toilets: "",
  };
}
