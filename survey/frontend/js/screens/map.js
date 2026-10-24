import { esc } from "../buttons.js";
import { matchingCountries } from "../countries.js";
import { applyKnown, currentVisit } from "../current_visit.js";

const DEFAULT_VIEW = { lat: 47.4881, lon: -121.7237, zoom: 13 };
const SEARCH_MIN_ZOOM = 14;
const SEARCH_WIDE_SPAN_LAT = 0.35;
const SEARCH_WIDE_SPAN_LON = 0.45;
const TILE_URL = "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const NO_P_NOTE = "No lot here. Zoom out with − and look around for a blue P, or Drop a pin.";
const ZOOM_IN_NOTE = "Zoom in to load parking and trails here.";
const SUGGEST_EMPTY = "Nothing matched. Try a trail name, a country, or coordinates like 47.49, -121.72.";
const filters = {
  parking: true,
  hike: true,
  bike: false,
  ski: false,
  climb: false,
  foot: false,
  camp: false,
  shelter: false,
  peak: false,
  range: false,
  viewpoint: false,
  beach: false,
  picnic: false,
  hot_spring: false,
  lift: false,
  ranger: false,
  boat: false,
  horse: false,
  hut: false,
  cave: false,
};
const ACTIVITY_FILTERS = [
  ["parking", "Lots"],
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
let viewLabel = "";
let viewCounts = null;
let clusterView = false;

let map = null;
let pins = [];
let dropped = null;
let loaded = [];
let knownPins = new Map();
let expandedKeys = new Set();
let expandedZoom = null;
let chosen = null;
let namedRouteKey = "";
let moveTimer = null;
let mapResizeHandler = null;
let mapFrameObserver = null;
let viewportHandler = null;
let suggestTimer = null;
let suggestToken = 0;
let suggestQuery = "";
let nameSuggestTimer = null;
let nameSuggestToken = 0;
let namingChoice = false;
let namingFieldSuggest = false;
const TRAIL_NAME_KINDS = new Set([
  "trail",
  "pin",
  "hike",
  "bike",
  "foot",
  "climb",
  "peak",
  "viewpoint",
]);
let suppressNoPNote = false;
let dismissedGuide = "";
let toastRole = "";
let toastText = "";
let pinsRequested = false;
let fromPin = false;
let droppingMode = false;
let loadToken = 0;
let soughtLabel = "";
let anchorTrailLabel = "";

function pinKey(pin) {
  return `${pin.osm_type}:${pin.osm_id}`;
}

function syncViewport() {
  const view = window.visualViewport;
  const root = document.documentElement;
  const height = Math.round(view ? view.height : window.innerHeight);
  const top = Math.round(view ? view.offsetTop : 0);
  const changed = root.style.getPropertyValue("--view-height") !== `${height}px`;
  root.style.setProperty("--view-height", `${height}px`);
  root.style.setProperty("--view-top", `${top}px`);
  return changed;
}

function watchViewport() {
  syncViewport();
  viewportHandler = () => {
    if (syncViewport()) map?.invalidateSize();
  };
  window.visualViewport?.addEventListener("resize", viewportHandler);
  window.visualViewport?.addEventListener("scroll", viewportHandler);
}

function unwatchViewport() {
  if (viewportHandler) {
    window.visualViewport?.removeEventListener("resize", viewportHandler);
    window.visualViewport?.removeEventListener("scroll", viewportHandler);
    viewportHandler = null;
  }
  document.documentElement.style.removeProperty("--view-height");
  document.documentElement.style.removeProperty("--view-top");
  document.body.classList.remove("map-typing");
}

function closeKeyboard() {
  document.getElementById("search-input")?.blur();
  document.body.classList.remove("map-typing");
}

function mergePins(incoming) {
  for (const pin of incoming) {
    knownPins.set(pinKey(pin), pin);
  }
  if (!map) {
    return incoming;
  }
  const padded = map.getBounds().pad(0.35);
  const visible = [];
  for (const pin of knownPins.values()) {
    if (padded.contains([pin.lat, pin.lon])) {
      visible.push(pin);
    }
  }
  return visible;
}

function markHtml(kind, count = 0, selected = false, community = false) {
  if (kind === "cluster") {
    return `<div class="mark mark-cluster" aria-label="${count} pins">${count}</div>`;
  }
  if (kind === "trail") {
    const fill = selected ? "#a34e22" : "#1f6b4a";
    return `<svg class="mark mark-trail" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M13.2 7.2h1.6V21" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M14.6 8.2h6.2l-1.15 2.15 1.15 2.15h-6.2z" fill="#ffffff"/>
    </svg>`;
  }
  if (kind === "lot") {
    const fill = selected ? "#a34e22" : (community ? "#7b4bb5" : "#1d4e89");
    return `<svg class="mark mark-lot" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2.5" y="2.5" width="23" height="23" rx="6" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M10.5 19.5V8.5h4.6c2.2 0 3.6 1.3 3.6 3.3 0 2.1-1.4 3.4-3.6 3.4h-2.3v4.3h-2.3zm2.3-6.2h2c1 0 1.6-.6 1.6-1.5 0-.9-.6-1.4-1.6-1.4h-2v2.9z" fill="#ffffff"/>
    </svg>`;
  }
  return `<svg class="mark mark-drop" viewBox="0 0 28 34" aria-hidden="true">
    <path d="M14 2C7.9 2 3 6.9 3 13c0 7.8 11 19 11 19s11-11.2 11-19C25 6.9 20.1 2 14 2z" fill="#17211c" stroke="#ffffff" stroke-width="2.5"/>
    <circle cx="14" cy="13" r="4" fill="#ffffff"/>
  </svg>`;
}

function isCommunityPin(pin) {
  return Boolean(pin && (pin.community || pin.pending || pin.source === "community"));
}

function keyCircle(fill, inner) {
  return `<svg class="mark key-mark" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="${fill}"/>${inner}</svg>`;
}

/** Twemoji 1f97e boot outline, scaled for 28×28 marks (single-color silhouette). */
function HIKE_BOOT_SVG(fill) {
  return `<g transform="translate(5.1 2.6) scale(0.585) rotate(-5 18 18)"><path fill="${fill}" d="M34.469 28.156c-.59-.885-2.458-2.365-4.5-2.656-2.112-.302-3.877.18-6.571-1.394-.086-.066-.171-.131-.273-.19-2.153-1.247-5.917-5.417-6-9.542-.047-2.336-3-2.625-5.375-2.333-2.375.292-10.083 2.083-9.792 3.25.248.991.224 5.316-.018 8.205-.366 2.27-.636 5.435-.636 7.44C1.303 31.599 2.333 32 2.333 32l14.198.5 17.688-.477s.933-.084.906-.711c-.042-.958-.156-2.406-.656-3.156z"/><path fill="${fill}" d="M1.334 31.216c.787.175 2.201.662 4.591.7 2.755.044 5.187-.525 8.308-.525 2.991 0 6.9.848 10.319.7 3.487-.152 7.35-.652 8.192-.799 1.667-.292 2.438-.479 2.438-.479s.365-.021.531.688c.167.708.304 2.083-.841 2.427-2.186.656-7.554 1.113-12.724 1.049-2.626-.032-5.549-.81-6.966-.976-1.417-.167-2.667-.287-3.062 0-.396.287.089.792-.946.933-2.58.35-8.614.044-9.928-.516-.672-.286-1.051-3.455.088-3.202z"/></g>`;
}

const WALK_PERSON_MARK = `<circle cx="14" cy="8.4" r="2.05" fill="#fff"/><path d="M14 10.6v4.6M14 13l-3.2 5.2M14 13l4.2 4.8M14 11.6l-2.9 2.1M14 11.6l3.1 1.7" fill="none" stroke="#fff" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`;

function activityMark(id) {
  if (id === "parking") {
    return `<svg class="mark mark-lot" viewBox="0 0 28 28" aria-hidden="true"><rect x="2.5" y="2.5" width="23" height="23" rx="6" fill="#1d4e89"/><path d="M10.5 19.5V8.5h4.6c2.2 0 3.6 1.3 3.6 3.3 0 2.1-1.4 3.4-3.6 3.4h-2.3v4.3h-2.3zm2.3-6.2h2c1 0 1.6-.6 1.6-1.5 0-.9-.6-1.4-1.6-1.4h-2v2.9z" fill="#ffffff"/></svg>`;
  }
  if (id === "hike") return keyCircle("#0b7a56", HIKE_BOOT_SVG("#fff"));
  if (id === "bike") {
    return keyCircle(
      "#1a7aa8",
      `<circle cx="9.2" cy="18.2" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="19" cy="18.2" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M9.2 18.2 12.6 11.4h4.6l2.2 6.8M12.6 11.4 15.4 18.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  if (id === "ski") {
    return keyCircle(
      "#3e6f96",
      `<path d="M9.8 7.8v12.8" fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round"/><path d="M17.6 8.2v12.2" fill="none" stroke="#fff" stroke-width="2.35" stroke-linecap="round"/>`,
    );
  }
  if (id === "climb") return placeMark("climb");
  if (id === "foot") {
    return keyCircle("#8a6244", WALK_PERSON_MARK);
  }
  if (id === "camp") {
    return keyCircle(
      "#5f8a32",
      `<path d="M5.8 20.6 14 8.2l8.2 12.4H5.8z" fill="#fff"/><path d="M14 8.6v12" stroke="#5f8a32" stroke-width="1.3"/>`,
    );
  }
  if (id === "shelter") {
    return keyCircle(
      "#8a6244",
      `<path d="M6.2 13.4 14 7.2l7.8 6.2V21H6.2v-7.6z" fill="#fff"/>`,
    );
  }
  if (id === "peak") return placeMark("peak");
  if (id === "range") return targetMark();
  if (id === "viewpoint") {
    return keyCircle(
      "#2a8a8a",
      `<circle cx="14" cy="14" r="3.3" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="14" cy="14" r="1.15" fill="#fff"/><path d="M14 6.8v2.3M14 18.9v2.3M6.8 14h2.3M18.9 14h2.3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }
  if (id === "beach") {
    return keyCircle(
      "#c4a035",
      `<path d="M5 19.5h18" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M6.5 19.5c1.5-2.8 3.5-4.2 7.5-4.2s6 1.4 7.5 4.2" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`,
    );
  }
  if (id === "picnic") {
    return keyCircle(
      "#6b8a3a",
      `<path d="M8 12h12M14 12V8.5M10.5 8.5h7" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M9 12 7.5 19M19 12l1.5 7" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`,
    );
  }
  if (id === "hot_spring") {
    return keyCircle(
      "#6a5a8a",
      `<path d="M10 18c0-3 2-5.5 4-8 2 2.5 4 5 4 8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 14.5c.8-1.2 1.5-2 2.5-2s1.7.8 2.5 2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`,
    );
  }
  if (id === "lift") {
    return keyCircle(
      "#4a6a8a",
      `<path d="M8 20V10l6-4 6 4v10" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="14" cy="11" r="1.3" fill="#fff"/>`,
    );
  }
  if (id === "ranger") {
    return keyCircle(
      "#3d6b4f",
      `<path d="M7 20V11l7-5 7 5v9" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><rect x="11.5" y="14" width="5" height="6" rx=".5" fill="#fff"/>`,
    );
  }
  if (id === "boat") {
    return keyCircle(
      "#2a7a9a",
      `<path d="M6 17h16l-2.5-4H8.5L6 17z" fill="#fff"/><path d="M14 8v5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  }
  if (id === "horse") {
    return keyCircle(
      "#7a5a3a",
      `<circle cx="10" cy="11" r="1.5" fill="#fff"/><path d="M10 12.5c1.5 2 3.5 3 6 3.5l-1 4.5H12l-.5-3" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  if (id === "hut") {
    return keyCircle(
      "#8a6244",
      `<path d="M6 19V12l8-6 8 6v7" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 19v-5h8v5" fill="#fff"/>`,
    );
  }
  if (id === "cave") {
    return keyCircle(
      "#5a5048",
      `<path d="M7 20c0-6 3.5-10 7-10s7 4 7 10" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="14" cy="15" r="2" fill="#fff"/>`,
    );
  }
  return keyCircle("#8a8178", `<circle cx="14" cy="14" r="3" fill="#fff"/>`);
}

function makeIcon(kind, count = 0, shifted = false, selected = false, community = false) {
  if (kind === "cluster") {
    return window.L.divIcon({
      className: "pin-wrap",
      html: markHtml("cluster", count),
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }
  const isDrop = kind === "drop";
  const size = selected ? 34 : 28;
  // When a trailhead sits on its lot, nudge the green icon up-left so the blue P stays visible.
  const anchor = isDrop ? [14, 31] : (shifted ? [size + 8, size + 8] : [size / 2, size / 2]);
  return window.L.divIcon({
    className: selected ? "pin-wrap is-selected" : "pin-wrap",
    html: markHtml(kind, 0, selected, community),
    iconSize: isDrop ? [28, 34] : [size, size],
    iconAnchor: anchor,
  });
}

function isChosenPin(pin) {
  return Boolean(chosen?.pin && pin && pinKey(chosen.pin) === pinKey(pin));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error("Map request failed");
  }
  return response.json();
}

function getMapView(bounds) {
  const params = new URLSearchParams({
    south: String(bounds.south),
    west: String(bounds.west),
    north: String(bounds.north),
    east: String(bounds.east),
  });
  return fetchJson(`/api/v1/map?${params.toString()}`);
}

function searchMap(q, lat, lon) {
  const params = new URLSearchParams({
    q,
    lat: String(lat),
    lon: String(lon),
  });
  return fetchJson(`/api/v1/map/search?${params.toString()}`);
}

function fetchNear(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
  return fetchJson(`/api/v1/map/near?${params.toString()}`);
}

function clearSearchChoices() {
  const modal = document.getElementById("search-choices-modal");
  const list = document.getElementById("search-choices-list");
  if (!modal || !list) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  list.replaceChildren();
  document.body.classList.remove("search-modal-open");
}

function showSearchChoices(choices) {
  const modal = document.getElementById("search-choices-modal");
  const list = document.getElementById("search-choices-list");
  if (!modal || !list) return;
  list.replaceChildren();
  list.setAttribute("role", "listbox");
  for (const choice of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-choice";
    btn.setAttribute("role", "option");
    const primary = document.createElement("span");
    primary.className = "search-choice-label";
    primary.textContent = choice.label;
    btn.append(primary);
    if (choice.detail) {
      const detail = document.createElement("span");
      detail.className = "search-choice-detail";
      detail.textContent = choice.detail;
      btn.append(detail);
    }
    btn.addEventListener("click", () => {
      applySearchChoice(choice);
    });
    list.append(btn);
  }
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("search-modal-open");
  list.querySelector(".search-choice")?.focus();
}

function isActivityPin(pin) {
  return Boolean(pin && pin.kind !== "parking" && pin.kind !== "trailhead" && pin.kind in filters);
}

function pinShown(pin) {
  if (pin.kind === "parking") return Boolean(filters.parking) || isChosenPin(pin);
  if (pin.kind === "trailhead") return filters.hike || isChosenPin(pin);
  if (pin.kind === "hike") return filters.hike || isChosenPin(pin);
  if (isActivityPin(pin)) return Boolean(filters[pin.kind]);
  return false;
}

function parkingIn(list) {
  return (list || []).some((pin) => pin.kind === "parking");
}

function parkingInView(list) {
  if (!map) return false;
  const bounds = map.getBounds();
  return (list || []).some((pin) => pin.kind === "parking" && bounds.contains([pin.lat, pin.lon]));
}

function parkingNearPoint(list, lat, lon, maxM = 650) {
  if (!map) return parkingIn(list);
  return (list || []).some(
    (pin) => pin.kind === "parking"
      && map.distance([lat, lon], [pin.lat, pin.lon]) <= maxM,
  );
}

function showAreaGuide(list, lat, lon) {
  if (userMarkedSpot() || chosen?.mode === "route") return;
  const lots = map
    ? (parkingInView(list) || (lat != null && lon != null && parkingNearPoint(list, lat, lon)))
    : parkingIn(list);
  if (!lots) {
    showToast(NO_P_NOTE, "is-warn", "guide");
    return;
  }
  if (!filters.hike) {
    showToast(
      "Hike pins are off. Tap a blue P, or turn Hike back on.",
      "is-warn",
      "guide",
    );
  }
}

function userMarkedSpot() {
  return Boolean(dropped) || chosen?.mode === "name" || hasLotSelection();
}

function placedPinNote() {
  const trail = chosen?.trailName;
  if (trail) {
    return `Does this look right for ${trail}? Drag the pin if you need to move it, then tap Continue.`;
  }
  return "Does this look right? Drag the pin if you need to move it, then tap Continue.";
}

function showPlacedPinBanner() {
  showToast(placedPinNote(), "is-ok", "selection");
}

function lotConfirmNote(state) {
  if (!state?.pin) {
    return "Tap Continue if this is the right lot.";
  }
  const name = state.pin.name || "this lot";
  if (state.snapped) {
    if (state.mode === "unnamed") {
      return "This is so close to a lot we already have that we'll use that one. It has no name, so tap Continue to label it.";
    }
    if (state.pin.name) {
      return `This is so close to ${state.pin.name} that we'll use that lot.`;
    }
    return "This is so close to a lot we already have that we'll use that one.";
  }
  if (state.mode === "unnamed") {
    return "This lot has no name on the map. Tap Continue to label it, or tap another blue P.";
  }
  if (state.askTrail) {
    return `Tap Continue if you parked at ${name}. You'll pick the trail next.`;
  }
  return `Does this look right? Tap Continue if you parked at ${name}, or choose another blue P.`;
}

function showLotConfirmBanner(state) {
  showToast(lotConfirmNote(state), "is-ok", "selection");
}

function hasLotSelection() {
  return Boolean(
    chosen && ["pin", "unnamed", "pick-lot", "trailhead"].includes(chosen.mode),
  );
}

function nearestParkingPins(near, choice, limit = 8) {
  return (near || [])
    .filter((pin) => pin.kind === "parking")
    .map((pin) => ({
      pin,
      d: map.distance([choice.lat, choice.lon], [pin.lat, pin.lon]),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ pin }) => pin);
}

function frameSearchArea(choice, near) {
  if (!map) return;
  const anchorZoom = choice.kind === "place" ? SEARCH_MIN_ZOOM : 15;
  const parking = nearestParkingPins(near, choice);
  const points = [
    [choice.lat, choice.lon],
    ...parking.map((pin) => [pin.lat, pin.lon]),
  ];
  if (points.length === 1) {
    map.setView([choice.lat, choice.lon], anchorZoom);
    return;
  }
  map.fitBounds(window.L.latLngBounds(points), {
    padding: [48, 48],
    maxZoom: 16,
    minZoom: SEARCH_MIN_ZOOM,
  });
}

function useChoiceName(choice) {
  const input = document.getElementById("search-input");
  const label = String(choice?.label || "").trim();
  if (!input || !label) return;
  namingChoice = true;
  input.value = label;
  suggestQuery = label;
  namingChoice = false;
}

function choiceActivity(choice) {
  if (choice.kind === "peak") return "peak";
  if (choice.kind === "climb") return "climb";
  if (choice.kind !== "place") return "";
  const type = String(choice.placeType || "").toLowerCase();
  if (type === "parking" || type === "hike") return "";
  return type in filters ? type : "";
}

function soughtPin(choice, kind) {
  let best = null;
  let bestMeters = 200;
  for (const pin of knownPins.values()) {
    if (pin.kind !== kind) continue;
    const meters = map.distance([choice.lat, choice.lon], [pin.lat, pin.lon]);
    if (meters < bestMeters) {
      bestMeters = meters;
      best = pin;
    }
  }
  return best || {
    osm_type: "search",
    osm_id: `${choice.lat},${choice.lon}`,
    kind,
    lat: choice.lat,
    lon: choice.lon,
    name: choice.label,
    named: true,
  };
}

function markSoughtPlace(choice, kind) {
  if (!map || !kind || userMarkedSpot()) return;
  filters[kind] = true;
  const pin = soughtPin(choice, kind);
  knownPins.set(pinKey(pin), pin);
  namedRouteKey = pinKey(pin);
  chosen = { mode: "route", pin, trailName: pin.name || choice.label };
  clearToast("guide");
  sheet(chosen);
  drawPins(mergePins([]));
}

async function applySearchChoice(choice) {
  if (!map || !choice) return;
  closeKeyboard();
  clearSearchChoices();
  clearWait();
  useChoiceName(choice);
  if (choice.kind === "pin" && choice.pin) {
    loadToken++;
    soughtLabel = "";
    anchorTrailLabel = "";
    clearToast();
    map.setView([choice.lat, choice.lon], 16);
    drawPins(mergePins([choice.pin]));
    selectPin(choice.pin);
    return;
  }
  const activity = choiceActivity(choice);
  if (choice.kind === "trail" || activity) {
    anchorTrailLabel = choice.label;
  } else {
    anchorTrailLabel = "";
  }
  const token = ++loadToken;
  clearSelection();
  soughtLabel = choice.label;
  dismissedGuide = "";
  suppressNoPNote = false;
  clearToast();
  showWait("Searching…");
  try {
    const payload = await fetchNear(choice.lat, choice.lon);
    if (token !== loadToken) return;
    soughtLabel = choice.label;
    const near = payload.places || [];
    if (near.length > 0) {
      mergePins(near);
      frameSearchArea(choice, near);
      drawPins(mergePins([]));
      await loadPins(true);
      clearWait();
      markSoughtPlace(choice, activity);
      showAreaGuide(loaded.length ? loaded : near, choice.lat, choice.lon);
    } else {
      frameSearchArea(choice, []);
      await loadPins(true);
      markSoughtPlace(choice, activity);
      showAreaGuide(loaded, choice.lat, choice.lon);
    }
  } catch (_err) {
    clearWait();
    frameSearchArea(choice, []);
    await loadPins(true);
    markSoughtPlace(choice, activity);
    showAreaGuide(loaded, choice.lat, choice.lon);
  }
}

function savePlace(body) {
  return fetchJson("/api/v1/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clearPins() {
  for (const marker of pins) {
    marker.remove();
  }
  pins = [];
}

function clearDropped() {
  if (dropped) {
    dropped.remove();
    dropped = null;
  }
}

function clearSelection() {
  droppingMode = false;
  syncDropButton();
  clearDropped();
  chosen = null;
  sheet(null);
  if (map && loaded.length > 0) drawPins(loaded);
}

function setBanner(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("is-wait", "is-warn", "is-ok");
  el.replaceChildren();
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (kind) {
    el.classList.add(kind);
    const mark = document.createElement("span");
    mark.className = "banner-mark";
    mark.setAttribute("aria-hidden", "true");
    el.append(mark);
  }
  const copy = document.createElement("span");
  copy.className = "banner-copy";
  copy.textContent = text;
  el.append(copy);
}

function showToast(text, kind, role) {
  const el = document.getElementById("map-toast");
  if (!el) return;
  if (role === "guide" && text && text === dismissedGuide) return;
  if (text && text === toastText && !el.hidden && toastRole === (role || "")) return;
  el.classList.remove("is-wait", "is-warn", "is-ok");
  el.replaceChildren();
  toastText = text || "";
  if (!text) {
    el.hidden = true;
    toastRole = "";
    return;
  }
  toastRole = role || "";
  el.hidden = false;
  if (kind) el.classList.add(kind);
  const copy = document.createElement("span");
  copy.className = "banner-copy";
  copy.textContent = text;
  el.append(copy);
  if (role === "guide") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "banner-dismiss";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissedGuide = text;
      showToast("");
    });
    el.append(close);
  }
}

function clearToast(role) {
  if (role && toastRole !== role) return;
  showToast("");
}

function showWait(text) {
  if (toastRole === "guide" || toastRole === "selection") return;
  showToast(text, "is-wait", "wait");
}

function clearWait() {
  if (toastRole === "wait") showToast("");
}

function setContinue(enabled) {
  const button = document.getElementById("map-next");
  if (button) button.disabled = !enabled;
}

function setNameReady(enabled) {
  const button = document.getElementById("name-next");
  if (button) button.disabled = !enabled;
}

function dropButtonMarkup(active) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2a6.2 6.2 0 0 0-6.2 6.2c0 4.6 6.2 11.4 6.2 11.4s6.2-6.8 6.2-11.4A6.2 6.2 0 0 0 12 2.2z" fill="currentColor"/><circle cx="12" cy="8.4" r="2.1" fill="#fff"/></svg><span>${active ? "Tap the map" : "Drop a pin"}</span>`;
}

function syncDropButton() {
  const btn = document.getElementById("drop-pin-btn");
  const card = document.getElementById("map-sheet");
  const frame = document.querySelector(".map-frame");
  if (!btn) return;
  if (droppingMode) {
    btn.innerHTML = dropButtonMarkup(true);
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    card?.classList.add("map-sheet-dropping");
    frame?.classList.add("map-dropping");
    if (map?.dragging) {
      map.dragging.disable();
    }
  } else {
    btn.innerHTML = dropButtonMarkup(false);
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
    card?.classList.remove("map-sheet-dropping");
    frame?.classList.remove("map-dropping");
    if (map?.dragging) {
      map.dragging.enable();
    }
  }
}

function fadeCard() {
  const card = document.getElementById("map-sheet");
  if (!card) return;
  card.classList.remove("card-fade");
  void card.offsetWidth;
  card.classList.add("card-fade");
}

function setSheetSub(sub, note, asHtml) {
  if (!note) {
    sub.hidden = true;
    sub.textContent = "";
    return;
  }
  sub.hidden = false;
  if (asHtml) sub.innerHTML = note;
  else sub.textContent = note;
}

function routeNote(pin) {
  if (pin?.lat != null && parkingNearPoint([...knownPins.values()], pin.lat, pin.lon)) {
    return "Tap the blue P where you left your car.";
  }
  return "No lot here. Zoom out with − and look around for a blue P, or Drop a pin.";
}

function sheet(state) {
  const title = document.getElementById("sheet-name");
  const sub = document.getElementById("sheet-sub");
  if (!title || !sub) return;
  fadeCard();
  let heading = "Where did you park?";
  let note = "Tap the blue P where you left your car.";
  let noteHtml = false;
  let enabled = false;
  if (state?.mode === "pick-lot") {
    heading = state.pin.name || "Trailhead";
    note = "Where did you park? Tap the blue P where you left your car.";
    noteHtml = false;
  } else if (state?.mode === "trailhead") {
    heading = state.pin.name || "Trailhead";
    note = "That’s where the trail starts. Now tap the blue P where you left your car.";
    noteHtml = false;
  } else if (state?.mode === "route") {
    heading = "Where did you park?";
    note = routeNote(state.pin);
    noteHtml = false;
  } else if (state?.mode === "pin") {
    heading = state.pin.name;
    note = "";
    noteHtml = false;
    enabled = true;
  } else if (state?.mode === "unnamed") {
    heading = state.trailName ? `Lot near ${state.trailName}` : "Unnamed parking lot";
    note = "";
    noteHtml = false;
    enabled = true;
  } else if (state?.mode === "name") {
    heading = "";
    note = "";
    noteHtml = false;
    enabled = true;
  } else if (droppingMode) {
    heading = "Now tap the map where you left your car";
    note = "Use + to zoom in so the pin lands in the right spot.";
    noteHtml = false;
  }
  const card = document.getElementById("map-sheet");
  title.textContent = heading;
  setSheetSub(sub, note, noteHtml);
  title.hidden = !heading;
  const lotPicked = state?.mode === "pin" || state?.mode === "unnamed";
  if (card) {
    card.classList.toggle("map-sheet-compact", state?.mode === "name");
    card.classList.toggle("map-sheet-lot", lotPicked);
  }
  setContinue(enabled);
  if (state?.mode === "name") {
    showPlacedPinBanner();
  } else if (lotPicked) {
    showLotConfirmBanner(state);
  } else if (!state && !droppingMode) {
    clearToast("selection");
  }
}

function showNameStep() {
  if (!chosen) return;
  const title = document.getElementById("name-title");
  const hint = document.getElementById("name-hint");
  const placeEntry = document.getElementById("name-entry");
  const trailEntry = document.getElementById("trail-entry");
  const placeInput = document.getElementById("place-name");
  const trailInput = document.getElementById("trail-name");
  const label = document.getElementById("name-label");
  const namingPlace = chosen.mode !== "pin";
  placeEntry.hidden = !namingPlace;
  trailEntry.hidden = !chosen.askTrail;
  if (chosen.mode === "unnamed") {
    title.textContent = "Name this lot";
    hint.textContent = chosen.trailName
      ? `Near ${chosen.trailName}. The lot itself has no name, so it is hard to tell apart from the others. Your name gives it an identity.`
      : "This lot has no name, and no trail is tied to it. A name and a trail give it an identity.";
    label.textContent = "Lot name";
  } else if (chosen.mode === "pin") {
    title.textContent = chosen.pin.name;
    hint.textContent = "This lot has a name, but no trail is tied to it. The trail is what connects this lot to the place.";
  } else {
    title.textContent = "Name this spot";
    hint.textContent = chosen.trailName
      ? `Near ${chosen.trailName}. This spot is not on the map yet. A name gives it an identity.`
      : "This spot is not on the map yet. A name and a trail give it an identity.";
    label.textContent = "Spot name";
  }
  if (placeInput) placeInput.value = chosen.typed || "";
  if (trailInput) trailInput.value = chosen.trailTyped || "";
  const mapStep = document.getElementById("map-step");
  const nameStep = document.getElementById("name-step");
  document.body.classList.add("map-naming");
  mapStep.classList.add("step-out");
  setTimeout(() => {
    mapStep.hidden = true;
    mapStep.classList.remove("step-out");
    nameStep.hidden = false;
    nameStep.classList.remove("step-in");
    void nameStep.offsetWidth;
    nameStep.classList.add("step-in");
    const focusField = namingPlace ? "place" : "trail";
    (namingPlace ? placeInput : trailInput)?.focus();
    queueNameSuggest(focusField, (namingPlace ? placeInput : trailInput)?.value?.trim() || "");
  }, 180);
  setNameReady(canContinue(chosen));
}

function hideNameStep() {
  const mapStep = document.getElementById("map-step");
  const nameStep = document.getElementById("name-step");
  if (!nameStep || nameStep.hidden) return;
  nameStep.classList.add("step-out");
  setTimeout(() => {
    nameStep.hidden = true;
    nameStep.classList.remove("step-out", "step-in");
    document.body.classList.remove("map-naming");
    mapStep.hidden = false;
    mapStep.classList.remove("step-in");
    void mapStep.offsetWidth;
    mapStep.classList.add("step-in");
    map?.invalidateSize();
  }, 160);
}

function closestLot(latlng, maxMeters) {
  let best = null;
  let bestMeters = maxMeters;
  for (const pin of loaded) {
    if (pin.kind !== "parking") continue;
    const meters = map.distance(latlng, [pin.lat, pin.lon]);
    if (meters < bestMeters) {
      bestMeters = meters;
      best = pin;
    }
  }
  return best;
}

function useNearbyLot(pin) {
  selectPin(pin);
  if (!chosen || (chosen.mode !== "pin" && chosen.mode !== "unnamed")) return;
  chosen.snapped = true;
  sheet(chosen);
}

function closestPin(latlng, maxMeters = 120) {
  let best = null;
  let bestMeters = maxMeters;
  for (const pin of loaded) {
    if (isActivityPin(pin)) continue;
    const meters = map.distance(latlng, [pin.lat, pin.lon]);
    if (meters < bestMeters) {
      bestMeters = meters;
      best = pin;
    }
  }
  return best;
}

function canContinue(state) {
  if (!state) return false;
  const placeOk = state.mode === "pin" || (state.typed || "").trim().length >= 2;
  const trailOk = !state.askTrail || (state.trailTyped || "").trim().length >= 2;
  return placeOk && trailOk;
}

function savedTrail() {
  if (!chosen) return "";
  if (chosen.askTrail) return (chosen.trailTyped || "").trim();
  if (chosen.mode === "unnamed-trail") return (chosen.typed || "").trim();
  if (chosen.trailName) return chosen.trailName;
  if (chosen.pin?.kind === "trailhead" && chosen.pin.name) return chosen.pin.name;
  return "";
}

function knownTrail(lat, lon, pin) {
  if (pin?.near_trail) return pin.near_trail;
  if (pin?.kind === "trailhead" && pin.named && pin.name) return pin.name;
  let best = null;
  let bestMeters = 800;
  for (const other of loaded) {
    if (!other.name || other.kind === "parking") continue;
    const trailLike =
      other.kind === "trailhead"
      || isActivityPin(other)
      || other.kind === "peak"
      || other.kind === "viewpoint";
    if (!trailLike) continue;
    const meters = map.distance([lat, lon], [other.lat, other.lon]);
    if (meters < bestMeters) {
      bestMeters = meters;
      best = other.name;
    }
  }
  return best;
}

function nearbyNamedFeatures(lat, lon, maxM = 1000) {
  if (!map) return [];
  const out = [];
  const seen = new Set();
  for (const pin of loaded) {
    const name = String(pin.name || "").trim();
    if (!name || pin.kind === "parking") continue;
    const meters = map.distance([lat, lon], [pin.lat, pin.lon]);
    if (meters > maxM) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind: pin.kind, meters, pin });
  }
  out.sort((a, b) => a.meters - b.meters);
  return out;
}

function featureHint(kind) {
  if (kind === "trailhead") return "Trailhead";
  if (kind in filters) return ACTIVITY_FILTERS.find(([id]) => id === kind)?.[1] || "Trail";
  if (kind === "peak") return "Peak";
  if (kind === "viewpoint") return "Viewpoint";
  return "Nearby";
}

function featureMark(kind) {
  if (kind === "trailhead") return markHtml("trail");
  if (kind in filters) return activityMark(kind);
  if (kind === "peak" || kind === "viewpoint") return activityMark(kind === "peak" ? "peak" : "viewpoint");
  return markHtml("lot");
}

function nameFieldNodes(field) {
  const panel = document.getElementById(field === "place" ? "place-suggest" : "trail-suggest");
  const list = document.getElementById(field === "place" ? "place-suggest-list" : "trail-suggest-list");
  const input = document.getElementById(field === "place" ? "place-name" : "trail-name");
  return { panel, list, input };
}

function applyNameValue(field, value) {
  if (!chosen) return;
  namingFieldSuggest = true;
  const text = String(value || "").trim();
  const { input } = nameFieldNodes(field);
  if (field === "place") {
    chosen.typed = text;
    if (input) input.value = text;
  } else {
    chosen.trailTyped = text;
    if (input) input.value = text;
  }
  namingFieldSuggest = false;
  hideNameSuggest(field);
  setNameReady(canContinue(chosen));
}

function hideNameSuggest(field) {
  if (field) {
    const { panel, list, input } = nameFieldNodes(field);
    hideSuggestPanel(panel, list, input);
    return;
  }
  hideNameSuggest("place");
  hideNameSuggest("trail");
}

function fillSuggestList(list, rows, emptyText) {
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "suggest-label";
    empty.textContent = emptyText;
    list.append(empty);
  } else {
    for (const row of rows) list.append(row);
  }
}

function openSuggestPanel(panel, list, input, rows, emptyText = SUGGEST_EMPTY) {
  if (!panel || !list) return;
  fillSuggestList(list, rows, emptyText);
  panel.hidden = false;
  input?.setAttribute("aria-expanded", "true");
}

function hideSuggestPanel(panel, list, input) {
  if (panel) panel.hidden = true;
  input?.setAttribute("aria-expanded", "false");
}

function matchesNameQuery(label, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

function lotNearLabel(name) {
  const rest = String(name || "").trim();
  return rest ? `Lot near ${rest}` : "";
}

function buildLotNameRows(query) {
  const rows = [];
  const seen = new Set();
  const pin = chosen?.pin;
  if (!pin || !map) return rows;
  const add = (label, hint, iconHtml) => {
    const clean = String(label || "").trim();
    if (!clean || !matchesNameQuery(clean, query)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(suggestRow(clean, hint, iconHtml, () => applyNameValue("place", clean)));
  };
  if (chosen.trailName) {
    add(lotNearLabel(chosen.trailName), "Suggested", markHtml("lot"));
  }
  for (const feat of nearbyNamedFeatures(pin.lat, pin.lon, 1200).slice(0, 10)) {
    add(lotNearLabel(feat.name), featureHint(feat.kind), featureMark(feat.kind));
  }
  return rows;
}

function buildTrailNameRows(query) {
  const rows = [];
  const seen = new Set();
  const pin = chosen?.pin;
  if (!pin || !map) return rows;
  const add = (label, hint, iconHtml) => {
    const clean = String(label || "").trim();
    if (!clean || !matchesNameQuery(clean, query)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(suggestRow(clean, hint, iconHtml, () => applyNameValue("trail", clean)));
  };
  if (chosen.trailName) {
    add(chosen.trailName, "Suggested", markHtml("trail"));
  }
  for (const feat of nearbyNamedFeatures(pin.lat, pin.lon, 1500)) {
    if (feat.kind === "parking") continue;
    add(feat.name, featureHint(feat.kind), featureMark(feat.kind));
    if (rows.length >= 12) break;
  }
  return rows;
}

function mergeNameSearchRows(field, query, choices) {
  const rows = field === "place" ? buildLotNameRows(query) : buildTrailNameRows(query);
  const seen = new Set();
  for (const row of rows) {
    const label = row.querySelector(".suggest-name")?.textContent?.trim().toLowerCase();
    if (label) seen.add(label);
  }
  const pin = chosen?.pin;
  const center = pin ? window.L.latLng(pin.lat, pin.lon) : map?.getCenter();
  const ranked = [...choices].sort((a, b) => {
    if (!center || !map) return choiceRank(a) - choiceRank(b);
    return map.distance(center, [a.lat, a.lon]) - map.distance(center, [b.lat, b.lon]);
  });
  for (const choice of ranked) {
    if (field === "trail" && !TRAIL_NAME_KINDS.has(choice.kind)) continue;
    const label = String(choice.label || "").trim();
    if (!label || !matchesNameQuery(label, query)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(suggestRow(
      label,
      choiceHint(choice),
      choiceMark(choice),
      () => applyNameValue(field, label),
      choiceWhere(choice),
      choice.detail,
    ));
    if (rows.length >= 10) break;
  }
  return rows;
}

function queueNameSuggest(field, text) {
  clearTimeout(nameSuggestTimer);
  const token = ++nameSuggestToken;
  const { panel, list, input } = nameFieldNodes(field);
  if (!panel || !list || !input) return;
  const query = text.trim();
  if (query.length < 2) {
    const nearby = field === "place" ? buildLotNameRows(query) : buildTrailNameRows(query);
    if (nearby.length === 0) {
      hideSuggestPanel(panel, list, input);
      return;
    }
    openSuggestPanel(panel, list, input, nearby);
    return;
  }
  nameSuggestTimer = setTimeout(async () => {
    try {
      const pin = chosen?.pin;
      const lat = pin?.lat ?? map.getCenter().lat;
      const lon = pin?.lon ?? map.getCenter().lng;
      const payload = await searchMap(query, lat, lon);
      if (token !== nameSuggestToken) return;
      const { input: liveInput } = nameFieldNodes(field);
      if (!liveInput || liveInput.value.trim() !== query) return;
      const rows = mergeNameSearchRows(field, query, payload.choices || []);
      openSuggestPanel(panel, list, liveInput, rows, "Nothing matched");
    } catch (_err) {
      if (token !== nameSuggestToken) return;
      openSuggestPanel(panel, list, input, mergeNameSearchRows(field, query, []));
    }
  }, 250);
}

function showTrailField(state) {
  const entry = document.getElementById("trail-entry");
  const input = document.getElementById("trail-name");
  if (!entry || !input) return;
  entry.hidden = !state?.askTrail;
  if (state?.askTrail) input.value = state.trailTyped || "";
}

function nearbyLots(pin, meters = 280) {
  return loaded.filter(
    (other) =>
      other.kind === "parking"
      && map.distance([pin.lat, pin.lon], [other.lat, other.lon]) <= meters,
  );
}

function focusOn(pin) {
  if (!map || !pin) return;
  const lots = pin.kind === "trailhead" ? nearbyLots(pin) : [];
  const points = [[pin.lat, pin.lon], ...lots.map((lot) => [lot.lat, lot.lon])];
  if (points.length > 1) {
    map.fitBounds(window.L.latLngBounds(points), {
      padding: [40, 40],
      maxZoom: 18,
      animate: true,
    });
    return;
  }
  map.setView([pin.lat, pin.lon], 18, { animate: true });
}

function selectPin(pin) {
  droppingMode = false;
  syncDropButton();
  clearDropped();
  focusOn(pin);

  let trailName = knownTrail(pin.lat, pin.lon, pin);
  let askTrailOverride = null;
  if (anchorTrailLabel) {
    trailName = anchorTrailLabel;
    askTrailOverride = false;
    anchorTrailLabel = "";
  }
  if (pin.kind === "trailhead") {
    chosen = nearbyLots(pin).length > 0
      ? { mode: "pick-lot", pin, trailName }
      : { mode: "trailhead", pin, trailName, askTrail: false };
  } else {
    const askTrail = askTrailOverride !== null ? askTrailOverride : !trailName;
    if (pin.named) {
      chosen = { mode: "pin", pin, trailName, askTrail, trailTyped: trailName && !askTrail ? trailName : "" };
    } else {
      chosen = {
        mode: "unnamed",
        pin,
        trailName,
        askTrail,
        typed: "",
        trailTyped: "",
      };
    }
  }
  sheet(chosen);
  if (loaded.length > 0) drawPins(loaded);
}

function distinctSpotCount(items) {
  const lots = items.filter((item) => item.kind === "parking");
  const trails = items.filter((item) => item.kind === "trailhead");
  let count = lots.length;
  for (const th of trails) {
    const overlapsLot = lots.some(
      (lot) => map.distance([th.lat, th.lon], [lot.lat, lot.lon]) <= 120,
    );
    if (!overlapsLot) {
      count += 1;
    }
  }
  return count;
}

function groupPins(places) {
  const zoom = map.getZoom();
  if (zoom >= 15) {
    return places.map((pin) => ({ items: [pin], count: 1, lat: pin.lat, lon: pin.lon }));
  }
  const pixelRadius = zoom <= 13 ? 38 : 28;
  const groups = [];
  const standalone = [];
  for (const pin of places) {
    if (expandedKeys.has(pinKey(pin))) {
      standalone.push({ items: [pin], count: 1, lat: pin.lat, lon: pin.lon });
      continue;
    }
    const pt = map.latLngToLayerPoint([pin.lat, pin.lon]);
    let joined = null;
    for (const group of groups) {
      const dist = pt.distanceTo(group.pt);
      if (dist < pixelRadius) {
        joined = group;
        break;
      }
    }
    if (joined) {
      joined.items.push(pin);
      const total = joined.items.length;
      joined.lat = (joined.lat * (total - 1) + pin.lat) / total;
      joined.lon = (joined.lon * (total - 1) + pin.lon) / total;
      joined.pt = map.latLngToLayerPoint([joined.lat, joined.lon]);
    } else {
      groups.push({ items: [pin], lat: pin.lat, lon: pin.lon, pt });
    }
  }
  const result = [...standalone];
  for (const group of groups) {
    const spotCount = distinctSpotCount(group.items);
    // If all pins in this group are just 1 parking lot + its overlapping trailhead,
    // draw both pins (P in front, green trailhead behind) instead of a cluster badge.
    if (spotCount <= 1) {
      for (const pin of group.items) {
        result.push({ items: [pin], count: 1, lat: pin.lat, lon: pin.lon });
      }
    } else {
      group.count = spotCount;
      result.push(group);
    }
  }
  return result;
}

function hikeMountain() {
  return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#0b7a56"/>${HIKE_BOOT_SVG("#fff")}</svg>`;
}

function activityIcon(kind) {
  return window.L.divIcon({
    className: "pin-wrap",
    html: kind === "hike" ? hikeMountain() : activityMark(kind),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function drawPins(places) {
  clearPins();
  clusterView = false;
  loaded = places;
  const shown = places.filter(pinShown);
  const groups = groupPins(shown.filter((pin) => !isActivityPin(pin)));
  for (const group of groups) {
    if (group.items.length > 1) {
      const marker = window.L.marker([group.lat, group.lon], {
        pane: "clusterPins",
        icon: makeIcon("cluster", group.count),
        zIndexOffset: 300,
      }).addTo(map);
      marker.on("click", (event) => {
        fromPin = true;
        window.L.DomEvent.stopPropagation(event);
        clearSelection();
        for (const item of group.items) {
          expandedKeys.add(pinKey(item));
        }
        const bounds = window.L.latLngBounds(
          group.items.map((item) => [item.lat, item.lon]),
        );
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });
        expandedZoom = map.getZoom();
        drawPins(loaded);
        setTimeout(() => {
          fromPin = false;
        }, 0);
      });
      pins.push(marker);
      continue;
    }
    const pin = group.items[0];
    const isTrail = pin.kind === "trailhead";
    const kind = isTrail ? "trail" : "lot";
    const selected = isChosenPin(pin);
    const besideLot = isTrail && places.some(
      (other) =>
        other.kind === "parking"
        && map.distance([pin.lat, pin.lon], [other.lat, other.lon]) <= 80,
    );
    const marker = window.L.marker([pin.lat, pin.lon], {
      pane: isTrail ? "trailPins" : "lotPins",
      icon: makeIcon(kind, 0, besideLot, selected, !isTrail && isCommunityPin(pin)),
      zIndexOffset: selected ? 900 : (isTrail ? 0 : 400),
    }).addTo(map);
    marker.on("click", (event) => {
      fromPin = true;
      window.L.DomEvent.stopPropagation(event);
      selectPin(pin);
      setTimeout(() => {
        fromPin = false;
      }, 0);
    });
    pins.push(marker);
  }
  for (const pin of shown.filter(isActivityPin)) {
    const marker = window.L.marker([pin.lat, pin.lon], {
      pane: "activityPins",
      icon: activityIcon(pin.kind),
      zIndexOffset: 200,
    }).addTo(map);
    if (pin.name && pinKey(pin) === namedRouteKey) {
      marker.bindTooltip(pin.name, {
        permanent: true,
        direction: "right",
        className: "route-label",
        offset: [10, 0],
        opacity: 1,
      });
    }
    marker.on("click", (event) => {
      fromPin = true;
      window.L.DomEvent.stopPropagation(event);
      const key = pinKey(pin);
      if (namedRouteKey === key) {
        namedRouteKey = "";
        if (chosen?.mode === "route") {
          chosen = null;
          sheet(null);
        }
      } else {
        namedRouteKey = key;
        droppingMode = false;
        syncDropButton();
        chosen = { mode: "route", pin, trailName: pin.name || "" };
        showToast("");
        sheet(chosen);
      }
      drawPins(loaded);
      setTimeout(() => {
        fromPin = false;
      }, 0);
    });
    pins.push(marker);
  }
  syncFilterPills();
}

function restoreSelectionNote() {
  if (chosen?.mode === "name") showPlacedPinBanner();
  else if (hasLotSelection()) showLotConfirmBanner(chosen);
}

function offerGuide(text) {
  if (toastRole === "guide" || toastRole === "selection") return;
  showToast(text, "is-warn", "guide");
}

function setMapLoading(on) {
  document.querySelector(".map-frame")?.classList.toggle("is-loading", on);
}

function drawClusters(clusters) {
  clearPins();
  loaded = [];
  clusterView = true;
  for (const cell of clusters) {
    const marker = window.L.marker([cell.lat, cell.lon], {
      pane: "clusterPins",
      icon: makeIcon("cluster", cell.count),
      zIndexOffset: 300,
    }).addTo(map);
    marker.on("click", (event) => {
      window.L.DomEvent.stopPropagation(event);
      map.setView([cell.lat, cell.lon], Math.min((map.getZoom() || 5) + 2, 14));
    });
    pins.push(marker);
  }
}

async function loadPins(keepNote = false) {
  const frame = document.getElementById("visit-map");
  if (!map || !frame || frame.offsetHeight < 40) return;
  pinsRequested = true;
  if (!keepNote) soughtLabel = "";
  const token = ++loadToken;
  setMapLoading(true);
  const bounds = map.getBounds();
  try {
    const payload = await getMapView({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    });
    if (token !== loadToken) return;
    viewCounts = payload.counts || null;
    if (payload.unavailable) {
      showToast(
        "Map places are not available right now. You can still drop a pin.",
        "is-warn",
        "guide",
      );
      syncFilterPills();
      return;
    }
    if (Array.isArray(payload.clusters) && payload.clusters.length > 0 && !(payload.places || []).length) {
      knownPins = new Map();
      drawClusters(payload.clusters);
      if (toastText === "Searching…" || toastText === ZOOM_IN_NOTE) clearToast("wait");
      syncFilterPills();
      return;
    }
    if (payload.zoomed_out) {
      if (knownPins.size > 0) {
        drawPins(mergePins([]));
      } else {
        clearPins();
        syncFilterPills();
      }
      if (!keepNote) {
        if (userMarkedSpot()) restoreSelectionNote();
        else showToast(ZOOM_IN_NOTE, "is-warn", "guide");
      } else if (toastText === "Searching…") {
        clearToast("wait");
      }
      return;
    }
    const merged = mergePins(payload.places);
    drawPins(merged);
    const noLot = !userMarkedSpot() && chosen?.mode !== "route" && !parkingInView(merged);
    if (noLot) {
      if (suppressNoPNote) {
        suppressNoPNote = false;
        if (toastText === "Searching…") clearToast("wait");
      } else {
        showToast(NO_P_NOTE, "is-warn", "guide");
      }
    } else if (toastText.startsWith("I didn't find a lot")) {
      clearToast("guide");
    } else if (toastText === "Searching…") {
      clearToast("wait");
    } else if (!keepNote && userMarkedSpot()) {
      restoreSelectionNote();
    }
  } catch (_err) {
    if (token !== loadToken) return;
    if (loaded.length > 0) {
      drawPins(loaded);
      return;
    }
    showToast(
      "Places are taking a moment to load. You can still use Drop a pin, or enter lat, lon in the search.",
      "is-warn",
      "guide",
    );
  } finally {
    if (token === loadToken) setMapLoading(false);
  }
}

function dropAt(lat, lon) {
  const latlng = window.L.latLng(lat, lon);
  const existing = closestLot(latlng, 100);
  if (existing) {
    useNearbyLot(existing);
    return;
  }
  droppingMode = false;
  syncDropButton();
  clearDropped();
  if (map.getZoom() < 18) {
    map.setView(latlng, 18);
  }
  dropped = window.L.marker(latlng, {
    pane: "dropPins",
    icon: makeIcon("drop"),
    draggable: true,
    zIndexOffset: 400,
  }).addTo(map);
  dropped.on("dragend", () => {
    const pos = dropped.getLatLng();
    const near = closestLot(pos, 100);
    if (near) {
      useNearbyLot(near);
      return;
    }
    if (chosen && chosen.mode === "name") {
      chosen.lat = pos.lat;
      chosen.lon = pos.lng;
      chosen.trailName = knownTrail(pos.lat, pos.lng, null);
      chosen.askTrail = !chosen.trailName;
      sheet(chosen);
    }
  });
  let trailName = knownTrail(lat, lon, null);
  let askTrail = !trailName;
  if (anchorTrailLabel) {
    trailName = anchorTrailLabel;
    askTrail = false;
    anchorTrailLabel = "";
  }
  chosen = {
    mode: "name",
    lat,
    lon,
    typed: "",
    trailName,
    askTrail,
    trailTyped: trailName && !askTrail ? trailName : "",
  };
  sheet(chosen);
  document.getElementById("place-name")?.focus();
}

function onMapClick(event) {
  if (fromPin) return;
  const target = event.originalEvent?.target;
  if (target?.closest?.(".leaflet-marker-icon")) return;
  if (!droppingMode) {
    // If they tapped very close to an existing pin, select that pin rather than dropping a black pin
    const nearPin = closestPin(event.latlng, 80);
    if (nearPin) {
      selectPin(nearPin);
    }
    return;
  }
  dropAt(event.latlng.lat, event.latlng.lng);
}

function coordinatePair(text) {
  const match = COORD_RE.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

async function jumpToCoordinates(lat, lon) {
  closeKeyboard();
  loadToken++;
  soughtLabel = "";
  anchorTrailLabel = "";
  clearToast();
  map.setView([lat, lon], 16);
  await loadPins(true);
  dropAt(lat, lon);
}

async function search() {
  const input = document.getElementById("search-input");
  const text = input.value.trim();
  if (text.length < 2 || !map) return;

  closeKeyboard();
  hideSuggest();
  clearSearchChoices();

  const pair = coordinatePair(text);
  if (pair) {
    await jumpToCoordinates(pair.lat, pair.lon);
    return;
  }

  const center = map.getCenter();
  const button = document.getElementById("search-button");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.textContent = "Wait";
  }
  input.disabled = true;
  showWait("Searching…");
  try {
    const payload = await searchMap(text, center.lat, center.lng);
    const choices = payload.choices || [];
    clearWait();
    if (choices.length === 0) {
      const countries = matchingCountries(text);
      if (countries.length === 1) {
        jumpToCountry(countries[0]);
        return;
      }
      if (countries.length > 1) {
        openSuggest(countryRows(text));
        return;
      }
      soughtLabel = "";
      showToast(
        `Nothing matched "${text}". Try a trail name, a country, coordinates (47.488, -121.724), or Drop a pin.`,
        "is-warn",
        "guide",
      );
      return;
    }
    if (choices.length === 1) {
      await applySearchChoice(choices[0]);
      return;
    }
    showSuggest(choices, text);
  } catch (_err) {
    clearWait();
    showToast(
      "Search is slow right now. Pan the map to your lot, use Drop a pin, or enter lat, lon in the search.",
      "is-warn",
      "guide",
    );
  } finally {
    input.disabled = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Find";
    }
  }
}

async function usePlace(go) {
  if (!chosen) return;
  setContinue(false);
  try {
    let body;
    const trailName = savedTrail();
    if (chosen.mode === "pin") {
      body = {
        osm_type: chosen.pin.osm_type,
        osm_id: chosen.pin.osm_id,
        trail_name: trailName,
      };
    } else if (chosen.mode === "unnamed" || chosen.mode === "unnamed-trail") {
      body = {
        osm_type: chosen.pin.osm_type,
        osm_id: chosen.pin.osm_id,
        name: chosen.typed.trim(),
        trail_name: trailName,
      };
    } else {
      body = {
        name: chosen.typed.trim(),
        trail_name: trailName,
        lat: chosen.lat,
        lon: chosen.lon,
      };
    }
    const saved = await savePlace(body);
    currentVisit.trailhead = saved;
    const placeKey = chosen.pin ? `${chosen.pin.osm_type}:${chosen.pin.osm_id}` : `${chosen.lat},${chosen.lon}`;
    applyKnown(chosen.pin?.known, placeKey);
    go("hikeStart");
  } catch (_err) {
    showToast("Could not save that place right now. Please try again.", "is-warn", "guide");
    setContinue(true);
  }
}

function choiceRank(choice) {
  if (choice.kind === "pin" && choice.pin?.kind === "parking") return 0;
  if (choice.kind === "pin") return 1;
  if (choice.kind === "trail") return 2;
  return 3;
}

const PLACE_WORDS = {
  city: "City",
  town: "Town",
  village: "Village",
  hamlet: "Village",
  suburb: "City",
  neighbourhood: "City",
  neighborhood: "City",
  county: "Region",
  state: "Region",
  country: "Country",
  peak: "Peak",
  mountain: "Peak",
  volcano: "Peak",
  range: "Range",
  park: "Park",
  national_park: "Park",
  protected_area: "Park",
  region: "Region",
  administrative: "Region",
  climb: "Climb",
  ski: "Snow",
  piste: "Snow",
  beach: "Beach",
  picnic: "Picnic",
  hot_spring: "Hot spring",
  lift: "Lift",
  ranger: "Ranger",
  boat: "Boat",
  horse: "Horse",
  hut: "Hut",
  cave: "Cave",
  path: "Trail",
  track: "Trail",
  footway: "Trail",
  hiking: "Trail",
  trail: "Trail",
  road: "Road",
};

function placeWord(type) {
  return PLACE_WORDS[String(type || "").toLowerCase()] || "Place";
}

function targetMark() {
  return keyCircle(
    "#3e4d63",
    `<circle cx="14" cy="14" r="5.2" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="2.5" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="0.9" fill="#fff"/>`,
  );
}

function placeMark(type) {
  const kind = placeWord(type);
  const peak = `<path d="M5.5 20.5 11 9.2l3.2 5.4L18.2 8 22.5 20.5Z" fill="#fff"/>`;
  if (kind === "Country") {
    return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#2a74c4"/><ellipse cx="14" cy="14" rx="5.5" ry="10.5" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M4.2 14h19.6M6.4 9.4h15.2M6.4 18.6h15.2" fill="none" stroke="#fff" stroke-width="1.4"/></svg>`;
  }
  if (kind === "Peak") {
    return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#6b4423"/>${peak}</svg>`;
  }
  if (kind === "Range") {
    return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#3d5a73"/><path d="M3.2 21.2 8.4 12.4l3.1 4.2 4.2-7.6 4.6 6.2 4.5-3.4 2.2 9.4Z" fill="#fff"/></svg>`;
  }
  if (kind === "Climb") {
    return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#5a4d9a"/><path d="M7.5 20.5 14 6.8l2.3 5.2 4.7 8.5Z" fill="#fff"/></svg>`;
  }
  if (kind === "Park") {
    return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#1e8f5a"/><path d="M14 7.2 19 16.2h-2.2V21h-5.6v-4.8H9Z" fill="#fff"/></svg>`;
  }
  if (kind === "Region") {
    return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#2a9a9a"/><path d="M7 17.5c2.2-3.2 4.4-4.6 7-4.6s4.8 1.4 7 4.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="10.2" r="1.7" fill="#fff"/></svg>`;
  }
  return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#e08a2a"/><path d="M8 20.4V12.6L14 8.2l6 4.4v7.8h-3.7v-4.5h-4.6v4.5H8z" fill="#fff"/></svg>`;
}

function routeMark() {
  return `<svg class="mark mark-route" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#3d6b4f"/><path d="M7.2 18.8c2.4-4 3.5-4 5.6 0s3.2 4 5.6 0 3.2-4 4.6 0" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

function choiceMark(choice) {
  if (choice.kind === "pin" && choice.pin?.kind === "parking") {
    return markHtml("lot", 0, false, isCommunityPin(choice.pin));
  }
  if (choice.kind === "trail") return hikeMountain();
  if (choice.kind === "pin") return markHtml("trail");
  if (choice.kind === "climb") return placeMark("climb");
  if (choice.kind === "peak") return placeMark("peak");
  if (String(choice.placeType || "").toLowerCase() === "range") return targetMark();
  const activity = choiceActivity(choice);
  if (activity) return activityMark(activity);
  return placeMark(choice.placeType);
}

function choiceHint(choice) {
  if (choice.kind === "pin" && choice.pin?.kind === "parking") return "Parking";
  if (choice.kind === "pin") return "Trailhead";
  if (choice.kind === "trail") return "Hike";
  if (choice.kind === "climb") return "Climb";
  if (choice.kind === "peak") return "Peak";
  const word = placeWord(choice.placeType);
  if (word === "Road" && /trail/i.test(choice.label || "")) return "Trail";
  return word;
}

function suggestRow(label, hint, markHtml, onClick, where, detail) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "suggest-row";
  const mark = document.createElement("span");
  mark.className = "suggest-mark";
  if (markHtml) mark.innerHTML = markHtml;
  const text = document.createElement("span");
  text.className = "suggest-text";
  const name = document.createElement("span");
  name.className = "suggest-name";
  name.textContent = label;
  text.append(name);
  const extras = [];
  const place = String(detail || "").trim();
  const region = String(where || "").trim();
  if (place && place !== label) extras.push(["suggest-detail", place]);
  if (region && region !== place) extras.push(["suggest-where", region]);
  const sameAsShown = extras.some(([, line]) => line.toLowerCase() === String(hint || "").trim().toLowerCase());
  if (hint && !sameAsShown && extras.length < 2) extras.push(["suggest-hint", hint]);
  for (const [className, line] of extras.slice(0, 2)) {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = line;
    text.append(node);
  }
  btn.append(mark, text);
  btn.addEventListener("click", onClick);
  return btn;
}

function choiceWhere(choice) {
  return String(choice.where || "").trim();
}

function hideSuggest() {
  const panel = document.getElementById("map-suggest");
  const shade = document.getElementById("suggest-shade");
  const input = document.getElementById("search-input");
  hideSuggestPanel(panel, document.getElementById("map-suggest-list"), input);
  if (shade) shade.hidden = true;
  document.getElementById("map-step")?.classList.remove("suggest-open");
}

function openSuggest(rows, emptyText = SUGGEST_EMPTY) {
  const panel = document.getElementById("map-suggest");
  const list = document.getElementById("map-suggest-list");
  const input = document.getElementById("search-input");
  openSuggestPanel(panel, list, input, rows, emptyText);
  const shade = document.getElementById("suggest-shade");
  if (shade) shade.hidden = false;
  document.getElementById("map-step")?.classList.add("suggest-open");
}

function countryRows(query) {
  return matchingCountries(query).map((country) => suggestRow(
    country.name,
    "Country",
    markHtml("drop"),
    () => jumpToCountry(country),
  ));
}

function jumpToCountry(country) {
  if (!country || !map) return;
  closeKeyboard();
  hideSuggest();
  viewLabel = country.name;
  loadToken++;
  expandedKeys.clear();
  expandedZoom = null;
  clearSelection();
  clearSearchChoices();
  dismissedGuide = "";
  clearToast();
  map.setView([country.lat, country.lon], country.zoom || 5);
  loadPins();
}

function queueSuggest(text) {
  clearTimeout(suggestTimer);
  const token = ++suggestToken;
  const pair = coordinatePair(text);
  if (pair) {
    suggestQuery = text;
    const label = `${pair.lat}, ${pair.lon}`;
    openSuggest([
      suggestRow(label, "Coordinates", markHtml("drop"), () => {
        hideSuggest();
        jumpToCoordinates(pair.lat, pair.lon);
      }),
    ]);
    return;
  }
  if (text.length < 2) {
    suggestQuery = text;
    hideSuggest();
    return;
  }
  suggestTimer = setTimeout(async () => {
    try {
      const center = map.getCenter();
      const payload = await searchMap(text, center.lat, center.lng);
      if (token !== suggestToken) return;
      const input = document.getElementById("search-input");
      if (!input || input.value.trim() !== text) return;
      suggestQuery = text;
      showSuggest(payload.choices || [], text);
    } catch (_err) {
      if (token !== suggestToken) return;
      suggestQuery = "";
      openSuggest([]);
    }
  }, 250);
}

function showSuggest(choices, query = "") {
  const center = map ? map.getCenter() : null;
  const ranked = [...choices].sort((a, b) => {
    if (!center || !map) return choiceRank(a) - choiceRank(b);
    const aNear = map.distance(center, [a.lat, a.lon]);
    const bNear = map.distance(center, [b.lat, b.lon]);
    return aNear - bNear;
  }).slice(0, 8);
  const rows = countryRows(query);
  const countryNames = new Set(matchingCountries(query).map((country) => country.name.toLowerCase()));
  for (const choice of ranked) {
    if (countryNames.has(String(choice.label || "").trim().toLowerCase())) continue;
    rows.push(suggestRow(choice.label, choiceHint(choice), choiceMark(choice), () => {
      hideSuggest();
      applySearchChoice(choice);
    }, choiceWhere(choice), choice.detail));
  }
  openSuggest(rows);
}

function activityCount(kind) {
  if (clusterView) return viewCounts?.[kind] || 0;
  if (!map || !loaded.length) return 0;
  const bounds = map.getBounds();
  let count = 0;
  const seen = new Set();
  for (const pin of loaded) {
    if (pin.kind !== kind || !bounds.contains([pin.lat, pin.lon])) continue;
    const key = pinKey(pin);
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

function syncFilterScrollHint() {
  const list = document.getElementById("map-filters");
  const wrap = list?.closest(".map-filters-scroll");
  if (!list || !wrap) return;
  const canScroll = list.scrollWidth > list.clientWidth + 2;
  const atStart = list.scrollLeft <= 6;
  const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 6;
  wrap.classList.toggle("has-more-end", canScroll && !atEnd);
  wrap.classList.toggle("has-more-start", canScroll && !atStart);
  list.classList.toggle("is-fit", !canScroll);
}

function syncFilterPills() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    const key = btn.dataset.filter;
    const on = Boolean(filters[key]);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const word = btn.querySelector(".filter-word");
    const label = word ? word.textContent.trim() : key;
    const count = activityCount(key);
    btn.hidden = count <= 0;
    const badge = btn.querySelector(".filter-count");
    if (badge) {
      badge.textContent = count > 0 ? String(count) : "";
      badge.setAttribute("aria-hidden", count > 0 ? "false" : "true");
    }
    const named = count > 0 ? `${label}, ${count} in view` : label;
    btn.setAttribute("aria-label", on ? `Turn off ${named}` : named);
  });
  syncFilterScrollHint();
}

function toggleFilter(key) {
  if (!(key in filters)) return;
  filters[key] = !filters[key];
  if (loaded.length > 0) drawPins(loaded);
  if (key === "hike" && !filters.hike) {
    showToast(
      "Hike pins are off. Tap a blue P, or turn Hike back on.",
      "is-warn",
      "guide",
    );
  } else if (toastText.startsWith("Hike pins are off")) {
    showToast("");
  }
  syncFilterPills();
}

export function render() {
  const activities = ACTIVITY_FILTERS.map(([id, label]) => {
    const on = filters[id] ? " is-on" : "";
    const pressed = filters[id] ? "true" : "false";
    const name = on ? `Turn off ${label}` : label;
    return `<button type="button" class="filter-pill${on}" data-filter="${id}" aria-pressed="${pressed}" aria-label="${name}">${activityMark(id)}<span class="filter-line"><span class="filter-word">${label}</span><span class="filter-count" aria-hidden="true"></span></span></button>`;
  }).join("");
  return `
    <div id="map-step">
    <button type="button" id="suggest-shade" class="suggest-shade" hidden aria-label="Close place list"></button>
    <div class="map-toolbar">
      <div class="map-search-wrap">
        <div class="map-search">
          <input id="search-input" type="search" placeholder="Trail, lot, peak, or country" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="map-suggest">
        </div>
        <div id="map-suggest" class="map-suggest" hidden>
          <div id="map-suggest-list"></div>
        </div>
      </div>
    </div>
    <div class="map-frame">
      <div id="visit-map" class="map-canvas"></div>
      <div class="map-loading" aria-hidden="true"><span class="map-dots"><span></span><span></span><span></span></span></div>
      <button type="button" id="drop-pin-btn" class="map-drop" aria-pressed="false">Drop a pin</button>
      <p id="map-toast" class="map-toast" hidden></p>
      <p id="searching-near" class="map-place" hidden></p>
    </div>
    <div class="map-filters-scroll">
      <span class="map-filters-back" aria-hidden="true">‹</span>
      <div id="map-filters" class="map-filters" aria-label="Activities">${activities}</div>
      <span class="map-filters-more" aria-hidden="true">›</span>
    </div>
    <div id="map-sheet" class="map-sheet">
      <h1 id="sheet-name" class="sheet-title">Where did you park?</h1>
      <p id="sheet-sub" class="sheet-helper">Tap the blue P where you left your car.</p>
      <div class="actions">
        <button type="button" class="back" id="back">Back</button>
        <button type="button" class="next" id="map-next" disabled>Continue</button>
      </div>
    </div>
    <div id="search-choices-modal" class="search-choices-modal" hidden aria-hidden="true">
      <button type="button" class="search-choices-backdrop" aria-label="Close list"></button>
      <div class="search-choices-panel" role="dialog" aria-labelledby="search-choices-heading">
        <button type="button" class="search-choices-close" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
        <p id="search-choices-heading" class="search-choices-title">Which one?</p>
        <div id="search-choices-list" class="search-choices-list"></div>
      </div>
    </div>
    </div>
    <div id="name-step" class="name-step" hidden>
      <h1 id="name-title">Name this spot</h1>
      <p id="name-hint" class="hint"></p>
      <div id="name-entry" class="name-entry">
        <label id="name-label" class="field-label" for="place-name">Lot name</label>
        <div class="name-field-wrap">
          <input id="place-name" type="text" maxlength="100" autocomplete="off" placeholder="e.g. main lot or overflow lot" role="combobox" aria-expanded="false" aria-controls="place-suggest">
          <div id="place-suggest" class="map-suggest name-suggest" hidden>
            <div id="place-suggest-list"></div>
          </div>
        </div>
      </div>
      <div id="trail-entry" class="name-entry" hidden>
        <label class="field-label" for="trail-name">Which trail is this for?</label>
        <div class="name-field-wrap">
          <input id="trail-name" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Mount Si" role="combobox" aria-expanded="false" aria-controls="trail-suggest">
          <div id="trail-suggest" class="map-suggest name-suggest" hidden>
            <div id="trail-suggest-list"></div>
          </div>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="back" id="name-back">Back to map</button>
        <button type="button" class="next" id="name-next" disabled>Continue</button>
      </div>
    </div>
  `;
}

export function destroyMap() {
  clearTimeout(moveTimer);
  clearTimeout(suggestTimer);
  clearTimeout(nameSuggestTimer);
  hideNameSuggest();
  if (mapResizeHandler) {
    window.removeEventListener("resize", mapResizeHandler);
    mapResizeHandler = null;
  }
  if (mapFrameObserver) {
    mapFrameObserver.disconnect();
    mapFrameObserver = null;
  }
  unwatchViewport();
  if (map) {
    map.remove();
    map = null;
  }
  pins = [];
  dropped = null;
  loaded = [];
  knownPins = new Map();
  expandedKeys = new Set();
  expandedZoom = null;
  chosen = null;
  droppingMode = false;
  anchorTrailLabel = "";
  pinsRequested = false;
  toastRole = "";
  toastText = "";
  clearSearchChoices();
}

export function mountMap(_root, go) {
  destroyMap();
  watchViewport();

  map = window.L.map("visit-map", {
    zoomControl: false,
    maxZoom: 19,
  }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);

  window.L.control.zoom({ position: "topright" }).addTo(map);

  map.createPane("activityPins");
  map.getPane("activityPins").style.zIndex = 600;
  map.createPane("trailPins");
  map.getPane("trailPins").style.zIndex = 610;
  map.createPane("lotPins");
  map.getPane("lotPins").style.zIndex = 640;
  map.createPane("clusterPins");
  map.getPane("clusterPins").style.zIndex = 660;
  map.createPane("dropPins");
  map.getPane("dropPins").style.zIndex = 680;

  window.L.tileLayer(TILE_URL, {
    maxZoom: 19,
    subdomains: "abc",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  map.on("zoomstart", () => {
    if (toastText.startsWith("I didn't find a lot")) {
      suppressNoPNote = true;
      clearToast("guide");
      showToast("Searching…", "is-wait", "wait");
    }
  });

  map.on("zoomend", () => {
    if (expandedZoom !== null && map.getZoom() < expandedZoom) {
      expandedKeys.clear();
      expandedZoom = null;
    }
    if (knownPins.size > 0) {
      drawPins(mergePins([]));
    }
  });

  map.on("moveend", () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      loadPins();
    }, 350);
  });

  map.on("click", onMapClick);

  function fitMap() {
    const frame = document.querySelector(".map-frame");
    if (!map || !frame || frame.offsetHeight < 40) return false;
    map.invalidateSize();
    if (!pinsRequested) loadPins();
    return true;
  }

  mapResizeHandler = () => {
    fitMap();
    syncFilterScrollHint();
  };
  window.addEventListener("resize", mapResizeHandler);

  document.getElementById("map-filters")?.addEventListener("scroll", syncFilterScrollHint, { passive: true });

  const mapFrameEl = document.querySelector(".map-frame");
  if (mapFrameEl && typeof ResizeObserver !== "undefined") {
    mapFrameObserver = new ResizeObserver(() => {
      fitMap();
    });
    mapFrameObserver.observe(mapFrameEl);
  }

  document.getElementById("suggest-shade")?.addEventListener("click", () => hideSuggest());

  document.getElementById("search-input").addEventListener("blur", () => {
    document.body.classList.remove("map-typing");
    window.scrollTo(0, 0);
    syncViewport();
  });
  document.getElementById("search-input").addEventListener("focus", () => {
    document.body.classList.add("map-typing");
    window.scrollTo(0, 0);
    if (namingChoice) return;
    const input = document.getElementById("search-input");
    const text = input.value.trim();
    const panel = document.getElementById("map-suggest");
    const list = document.getElementById("map-suggest-list");
    if (text && text === suggestQuery && panel && !panel.hidden && list?.querySelector(".suggest-row")) return;
    queueSuggest(text);
  });
  document.getElementById("search-input").addEventListener("input", () => {
    if (namingChoice) return;
    const input = document.getElementById("search-input");
    queueSuggest(input.value.trim());
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".map-search-wrap")) hideSuggest();
    if (!event.target.closest(".name-field-wrap")) hideNameSuggest();
  });
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => toggleFilter(btn.dataset.filter));
  });

  document.getElementById("search-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      search();
    }
  });
  document.querySelector(".search-choices-backdrop")?.addEventListener("click", clearSearchChoices);
  document.querySelector(".search-choices-close")?.addEventListener("click", clearSearchChoices);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.getElementById("search-choices-modal");
    if (modal && !modal.hidden) clearSearchChoices();
    else if (!document.getElementById("name-step")?.hidden) hideNameSuggest();
    else hideSuggest();
  });

  document.getElementById("drop-pin-btn").addEventListener("click", () => {
    droppingMode = !droppingMode;
    if (droppingMode) {
      clearDropped();
      chosen = null;
      setContinue(false);
    }
    syncDropButton();
    sheet(chosen);
  });

  document.getElementById("place-name").addEventListener("focus", () => {
    if (!chosen || chosen.mode === "pin") return;
    queueNameSuggest("place", document.getElementById("place-name").value.trim());
  });
  document.getElementById("place-name").addEventListener("input", (event) => {
    if (!chosen || chosen.mode === "pin") return;
    if (!namingFieldSuggest) chosen.typed = event.target.value;
    setNameReady(canContinue(chosen));
    queueNameSuggest("place", event.target.value.trim());
  });

  document.getElementById("trail-name").addEventListener("focus", () => {
    if (!chosen?.askTrail) return;
    queueNameSuggest("trail", document.getElementById("trail-name").value.trim());
  });
  document.getElementById("trail-name").addEventListener("input", (event) => {
    if (!chosen) return;
    if (!namingFieldSuggest) chosen.trailTyped = event.target.value;
    setNameReady(canContinue(chosen));
    queueNameSuggest("trail", event.target.value.trim());
  });

  document.getElementById("map-next").addEventListener("click", () => {
    if (!chosen) return;
    if (chosen.mode === "pin" && !chosen.askTrail) {
      usePlace(go);
      return;
    }
    showNameStep();
  });
  document.getElementById("name-back").addEventListener("click", () => {
    hideNameSuggest();
    hideNameStep();
  });
  document.getElementById("name-next").addEventListener("click", () => usePlace(go));

  requestAnimationFrame(() => {
    if (!fitMap()) {
      requestAnimationFrame(fitMap);
    }
  });
  syncDropButton();
  sheet(null);
  loadPins();
  requestAnimationFrame(syncFilterScrollHint);
}
