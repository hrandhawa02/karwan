import { esc } from "../buttons.js";
import { currentVisit } from "../current_visit.js";

const DEFAULT_VIEW = { lat: 47.4881, lon: -121.7237, zoom: 13 };
const SEARCH_MIN_ZOOM = 14;
const SEARCH_WIDE_SPAN_LAT = 0.35;
const SEARCH_WIDE_SPAN_LON = 0.45;
const TILE_URL = "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const NO_P_NOTE = "I didn't find a lot in this area. Drop a pin to mark where you parked.";
const SUGGEST_EMPTY = "Nothing matched. Try a town, or coordinates like 47.49, -121.72.";
const REGIONS = [
  { label: "North Bend", placeType: "town", lat: 47.4881, lon: -121.7237 },
  { label: "Mount Rainier", placeType: "park", lat: 46.7865, lon: -121.7360 },
  { label: "Olympic Peninsula", placeType: "region", lat: 47.9693, lon: -123.4986 },
  { label: "Leavenworth", placeType: "town", lat: 47.5962, lon: -120.6615 },
  { label: "North Cascades", placeType: "range", lat: 48.7110, lon: -121.2065 },
];

const filters = {
  hike: true,
  bike: false,
  ski: false,
  climb: false,
  run: false,
  camp: false,
  shelter: false,
  peak: false,
  range: false,
  viewpoint: false,
};
const COUNTED_KINDS = new Set(["hike", "climb"]);
const ACTIVITY_FILTERS = [
  ["hike", "Hike"],
  ["bike", "Bike"],
  ["ski", "Ski"],
  ["climb", "Climb"],
  ["run", "Run"],
  ["camp", "Camp"],
  ["shelter", "Shelter"],
  ["peak", "Peak"],
  ["range", "Range"],
  ["viewpoint", "Viewpoint"],
];
let viewLabel = "North Bend";

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
let suggestTimer = null;
let suggestToken = 0;
let suggestQuery = "";
let namingChoice = false;
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
    const fill = selected ? "#a34e22" : "#0b7a56";
    return `<svg class="mark mark-trail" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M6.4 18.6c2.2-3.6 3.4-3.6 5.4 0s3.2 3.6 5.4 0 3-3.6 4.4 0" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
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

function activityMark(id) {
  if (id === "hike") return markHtml("trail");
  if (id === "bike") {
    return keyCircle(
      "#1a7aa8",
      `<circle cx="9.2" cy="18.2" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="19" cy="18.2" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M9.2 18.2 12.6 11.4h4.6l2.2 6.8M12.6 11.4 15.4 18.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  if (id === "ski") {
    return keyCircle(
      "#3e6f96",
      `<path d="M10 7.5c2.4 5.2 2.2 7.4-.2 13M17.2 7.5c2.4 5.2 2.2 7.4-.2 13" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
    );
  }
  if (id === "climb") return placeMark("climb");
  if (id === "run") {
    return keyCircle(
      "#c4526a",
      `<circle cx="15.2" cy="8.2" r="2" fill="#fff"/><path d="M14.6 11.2 11.4 16.2l-3.2 1.6M14.2 12.4l3.4 1.4 1.8 4.4M10.8 16.2 14.2 21" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
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
  if (pin.kind === "parking") return true;
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

function showAreaGuide(list) {
  if (userMarkedSpot()) return;
  const lots = map ? parkingInView(list) : parkingIn(list);
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

function frameSearchArea(choice, near) {
  if (!map) return;
  const anchorZoom = choice.kind === "place" ? SEARCH_MIN_ZOOM : 15;
  if (near.length === 0) {
    map.setView([choice.lat, choice.lon], anchorZoom);
    return;
  }
  const bounds = window.L.latLngBounds([
    [choice.lat, choice.lon],
    ...near.map((pin) => [pin.lat, pin.lon]),
  ]);
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const spanLat = ne.lat - sw.lat;
  const spanLon = ne.lng - sw.lng;
  const spread =
    near.length > 12
    || spanLat > SEARCH_WIDE_SPAN_LAT
    || spanLon > SEARCH_WIDE_SPAN_LON;
  if (spread) {
    map.setView([choice.lat, choice.lon], anchorZoom);
    return;
  }
  map.fitBounds(bounds, {
    padding: [36, 36],
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

async function applySearchChoice(choice) {
  if (!map || !choice) return;
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
  if (choice.kind === "trail") {
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
      clearWait();
      showAreaGuide(near);
    } else {
      frameSearchArea(choice, []);
      await loadPins(true);
      showAreaGuide(loaded);
    }
  } catch (_err) {
    clearWait();
    frameSearchArea(choice, []);
    await loadPins(true);
    showAreaGuide(loaded);
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

function sheet(state) {
  const title = document.getElementById("sheet-name");
  const sub = document.getElementById("sheet-sub");
  if (!title || !sub) return;
  fadeCard();
  let heading = "Tap the P in the blue symbol or drop a pin for the lot.";
  let note = "";
  let noteHtml = false;
  let enabled = false;
  if (state?.mode === "pick-lot") {
    heading = state.pin.name || "Trailhead";
    note = "Tap the lot you used.";
    noteHtml = false;
  } else if (state?.mode === "trailhead") {
    heading = state.pin.name || "Trailhead";
    note = "That’s the trailhead. Tap your lot, or use Drop a pin.";
    noteHtml = false;
  } else if (state?.mode === "route") {
    heading = state.pin?.name || "Trail";
    note = "Tap a P for the lot, or drop a pin.";
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
    heading = "Drop a pin on the lot";
    note = "Tap where you parked. You can zoom in to fix the point.";
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
  const pinBtn = document.getElementById("drop-pin-btn");
  if (pinBtn) {
    pinBtn.hidden = enabled;
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
    (namingPlace ? placeInput : trailInput)?.focus();
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
    if (other.kind !== "trailhead" || !other.named || !other.name) continue;
    const meters = map.distance([lat, lon], [other.lat, other.lon]);
    if (meters < bestMeters) {
      bestMeters = meters;
      best = other.name;
    }
  }
  return best;
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
  return `<svg class="mark mark-place" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="#0b7a56"/><path d="M5.5 20.5 11 9.2l3.2 5.4L18.2 8 22.5 20.5Z" fill="#fff"/></svg>`;
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

async function loadPins(keepNote = false) {
  const frame = document.getElementById("visit-map");
  if (!map || !frame || frame.offsetHeight < 40) return;
  pinsRequested = true;
  if (!keepNote) soughtLabel = "";
  const token = ++loadToken;
  if (
    !userMarkedSpot()
    && toastRole !== "selection"
    && !toastText.startsWith("I didn't find a lot")
    && !parkingInView(loaded)
  ) {
    showToast("Searching…", "is-wait", "wait");
  }
  const bounds = map.getBounds();
  try {
    const payload = await getMapView({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    });
    if (token !== loadToken) return;
    if (payload.zoomed_out) {
      if (knownPins.size > 0) {
        drawPins(mergePins([]));
      } else {
        clearPins();
      }
      if (!keepNote) {
        if (userMarkedSpot()) restoreSelectionNote();
        else offerGuide(NO_P_NOTE);
      } else if (toastText === "Searching…") {
        clearToast("wait");
      }
      return;
    }
    const merged = mergePins(payload.places);
    drawPins(merged);
    const noLot = !userMarkedSpot() && !parkingInView(merged);
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
      "OpenStreetMap is taking a moment to respond. You can still use Drop a pin, or enter lat, lon in the search.",
      "is-warn",
      "guide",
    );
  }
}

function dropAt(lat, lon) {
  const latlng = window.L.latLng(lat, lon);
  // If an existing OpenStreetMap pin is right at this spot (< 100 m), stick with it!
  const existing = closestPin(latlng, 100);
  if (existing && existing.named) {
    selectPin(existing);
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
    if (chosen && chosen.mode === "name") {
      const pos = dropped.getLatLng();
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
      const regions = matchingRegions(text);
      if (regions.length === 1) {
        jumpToRegion(regions[0]);
        return;
      }
      if (regions.length > 1) {
        showRegions(text);
        return;
      }
      soughtLabel = "";
      showToast(
        `Nothing matched "${text}" from here. Try a town, a shorter name, coordinates (47.488, -121.724), or Drop a pin.`,
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
  ski: "Ski",
  piste: "Ski",
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
  if (hint && extras.length < 2) extras.push(["suggest-hint", hint]);
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
  if (panel) panel.hidden = true;
  if (shade) shade.hidden = true;
  input?.setAttribute("aria-expanded", "false");
  document.getElementById("map-step")?.classList.remove("suggest-open");
}

function matchingRegions(query) {
  const text = query.trim().toLowerCase();
  if (!text) return REGIONS;
  return REGIONS.filter((region) => region.label.toLowerCase().includes(text));
}

function openSuggest(rows, emptyText = SUGGEST_EMPTY) {
  const panel = document.getElementById("map-suggest");
  const list = document.getElementById("map-suggest-list");
  const input = document.getElementById("search-input");
  if (!panel || !list) return;
  list.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "suggest-label";
    empty.textContent = emptyText;
    list.append(empty);
  } else {
    for (const row of rows) list.append(row);
  }
  panel.hidden = false;
  const shade = document.getElementById("suggest-shade");
  if (shade) shade.hidden = false;
  input?.setAttribute("aria-expanded", "true");
  document.getElementById("map-step")?.classList.add("suggest-open");
}

function regionRows(query) {
  return matchingRegions(query).map((region) => suggestRow(
    region.label,
    placeWord(region.placeType),
    placeMark(region.placeType),
    () => jumpToRegion(region),
  ));
}

function showRegions(query = "") {
  openSuggest(regionRows(query));
}

function jumpToRegion(region) {
  if (!region || !map) return;
  hideSuggest();
  viewLabel = region.label;
  loadToken++;
  expandedKeys.clear();
  expandedZoom = null;
  clearSelection();
  clearSearchChoices();
  dismissedGuide = "";
  clearToast();
  map.setView([region.lat, region.lon], 13);
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
    showRegions(text);
    return;
  }
  const panel = document.getElementById("map-suggest");
  const list = document.getElementById("map-suggest-list");
  const already = suggestQuery === text && panel && !panel.hidden && list?.querySelector(".suggest-row");
  if (!already) openSuggest([], "Searching…");
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
  const rows = regionRows(query);
  const regionNames = new Set(matchingRegions(query).map((region) => region.label.toLowerCase()));
  for (const choice of ranked) {
    if (regionNames.has(String(choice.label || "").trim().toLowerCase())) continue;
    rows.push(suggestRow(choice.label, choiceHint(choice), choiceMark(choice), () => {
      hideSuggest();
      applySearchChoice(choice);
    }, choiceWhere(choice), choice.detail));
  }
  openSuggest(rows);
}

function activityCount(kind) {
  if (!map || !COUNTED_KINDS.has(kind)) return 0;
  const bounds = map.getBounds();
  let count = 0;
  for (const pin of loaded) {
    if (pin.kind === kind && bounds.contains([pin.lat, pin.lon])) count += 1;
  }
  return count;
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
    let badge = btn.querySelector(".filter-count");
    if (count > 0) {
      if (!badge && word) {
        badge = document.createElement("span");
        badge.className = "filter-count";
        word.after(badge);
      }
      if (badge) badge.textContent = String(count);
    } else if (badge) {
      badge.remove();
    }
    const named = count > 0 ? `${label}, ${count} in view` : label;
    btn.setAttribute("aria-label", on ? `Turn off ${named}` : named);
  });
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
    return `<button type="button" class="filter-pill${on}" data-filter="${id}" aria-pressed="${pressed}" aria-label="${name}">${activityMark(id)}<span class="filter-line"><span class="filter-word">${label}</span></span></button>`;
  }).join("");
  return `
    <div id="map-step">
    <button type="button" id="suggest-shade" class="suggest-shade" hidden aria-label="Close place list"></button>
    <div class="map-toolbar">
      <div class="map-search-wrap">
        <div class="map-search">
          <input id="search-input" type="search" placeholder="Trail, lot, peak, or town" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="map-suggest">
        </div>
        <div id="map-suggest" class="map-suggest" hidden>
          <div id="map-suggest-list"></div>
        </div>
      </div>
      <div class="map-filters" aria-label="Activities">${activities}</div>
    </div>
    <div class="map-frame">
      <div id="visit-map" class="map-canvas"></div>
      <button type="button" id="drop-pin-btn" class="map-drop" aria-pressed="false">Drop a pin</button>
      <p id="map-toast" class="map-toast" hidden></p>
      <p id="searching-near" class="map-place" hidden></p>
    </div>
    <div id="map-sheet" class="map-sheet">
      <h1 id="sheet-name" class="sheet-title">Tap the P in the blue symbol or drop a pin for the lot.</h1>
      <p id="sheet-sub" class="sheet-helper" hidden></p>
      <div class="actions">
        <button type="button" class="back" id="back">&lt;&lt; Back</button>
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
        <input id="place-name" type="text" maxlength="100" autocomplete="off" placeholder="e.g. main lot or overflow lot">
      </div>
      <div id="trail-entry" class="name-entry" hidden>
        <label class="field-label" for="trail-name">Which trail is this for?</label>
        <input id="trail-name" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Mount Si">
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
  if (mapResizeHandler) {
    window.removeEventListener("resize", mapResizeHandler);
    mapResizeHandler = null;
  }
  if (mapFrameObserver) {
    mapFrameObserver.disconnect();
    mapFrameObserver = null;
  }
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
  };
  window.addEventListener("resize", mapResizeHandler);

  const mapFrameEl = document.querySelector(".map-frame");
  if (mapFrameEl && typeof ResizeObserver !== "undefined") {
    mapFrameObserver = new ResizeObserver(() => {
      fitMap();
    });
    mapFrameObserver.observe(mapFrameEl);
  }

  document.getElementById("suggest-shade")?.addEventListener("click", () => hideSuggest());

  document.getElementById("search-input").addEventListener("focus", () => {
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

  document.getElementById("place-name").addEventListener("input", (event) => {
    if (!chosen || chosen.mode === "pin") return;
    chosen.typed = event.target.value;
    setNameReady(canContinue(chosen));
  });

  document.getElementById("trail-name").addEventListener("input", (event) => {
    if (!chosen) return;
    chosen.trailTyped = event.target.value;
    setNameReady(canContinue(chosen));
  });

  document.getElementById("map-next").addEventListener("click", () => {
    if (!chosen) return;
    if (chosen.mode === "pin" && !chosen.askTrail) {
      usePlace(go);
      return;
    }
    showNameStep();
  });
  document.getElementById("name-back").addEventListener("click", hideNameStep);
  document.getElementById("name-next").addEventListener("click", () => usePlace(go));

  requestAnimationFrame(() => {
    if (!fitMap()) {
      requestAnimationFrame(fitMap);
    }
  });
  syncDropButton();
  sheet(null);
  loadPins();
}
