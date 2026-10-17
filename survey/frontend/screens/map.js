import { esc } from "../buttons.js";
import { currentVisit } from "../current_visit.js";

const DEFAULT_VIEW = { lat: 47.4881, lon: -121.7237, zoom: 13 };
const TILE_URL = "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const REGIONS = [
  { label: "North Bend", lat: 47.4881, lon: -121.7237 },
  { label: "Mount Rainier", lat: 46.7865, lon: -121.7360 },
  { label: "Olympic Peninsula", lat: 47.9693, lon: -123.4986 },
  { label: "Leavenworth", lat: 47.5962, lon: -120.6615 },
  { label: "North Cascades", lat: 48.7110, lon: -121.2065 },
];

let map = null;
let pins = [];
let dropped = null;
let loaded = [];
let knownPins = new Map();
let expandedKeys = new Set();
let expandedZoom = null;
let chosen = null;
let moveTimer = null;
let fromPin = false;
let droppingMode = false;
let loadToken = 0;
let soughtLabel = "";

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

function markHtml(kind, count = 0) {
  if (kind === "cluster") {
    return `<div class="mark mark-cluster" aria-label="${count} pins">${count}</div>`;
  }
  if (kind === "trail") {
    return `<svg class="mark mark-trail" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12.5" fill="#0b7a56" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M7.5 19.5 L13 9.5 L16.5 15.5 L19 12 L21.5 19.5 Z" fill="#ffffff"/>
    </svg>`;
  }
  if (kind === "lot") {
    return `<svg class="mark mark-lot" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="2.5" y="2.5" width="23" height="23" rx="6" fill="#1d4e89" stroke="#ffffff" stroke-width="2.5"/>
      <path d="M10.5 19.5V8.5h4.6c2.2 0 3.6 1.3 3.6 3.3 0 2.1-1.4 3.4-3.6 3.4h-2.3v4.3h-2.3zm2.3-6.2h2c1 0 1.6-.6 1.6-1.5 0-.9-.6-1.4-1.6-1.4h-2v2.9z" fill="#ffffff"/>
    </svg>`;
  }
  return `<svg class="mark mark-drop" viewBox="0 0 28 34" aria-hidden="true">
    <path d="M14 2C7.9 2 3 6.9 3 13c0 7.8 11 19 11 19s11-11.2 11-19C25 6.9 20.1 2 14 2z" fill="#17211c" stroke="#ffffff" stroke-width="2.5"/>
    <circle cx="14" cy="13" r="4" fill="#ffffff"/>
  </svg>`;
}

function makeIcon(kind, count = 0, shifted = false) {
  if (kind === "cluster") {
    return window.L.divIcon({
      className: "pin-wrap",
      html: markHtml("cluster", count),
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }
  const isDrop = kind === "drop";
  // When a trailhead sits on its lot, nudge the green icon up-left so the blue P stays visible.
  const anchor = isDrop ? [14, 31] : (shifted ? [36, 36] : [14, 14]);
  return window.L.divIcon({
    className: "pin-wrap",
    html: markHtml(kind),
    iconSize: isDrop ? [28, 34] : [28, 28],
    iconAnchor: anchor,
  });
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
}

function setBanner(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("is-wait", "is-warn");
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
  el.append(document.createTextNode(text));
}

function emptyViewNote() {
  const found = soughtLabel ? `${soughtLabel} is on the map. ` : "";
  return `${found}No trailhead or parking lot in this view. Zoom out for the area around it, or drop a pin where you parked.`;
}

function setContinue(enabled) {
  const button = document.getElementById("map-next");
  if (button) button.disabled = !enabled;
}

function setNameReady(enabled) {
  const button = document.getElementById("name-next");
  if (button) button.disabled = !enabled;
}

function syncDropButton() {
  const btn = document.getElementById("drop-pin-btn");
  if (!btn) return;
  if (droppingMode) {
    btn.textContent = "Cancel";
    btn.classList.add("active");
  } else {
    btn.textContent = "Drop a pin";
    btn.classList.remove("active");
  }
}

function fadeCard() {
  const card = document.getElementById("map-sheet");
  if (!card) return;
  card.classList.remove("card-fade");
  void card.offsetWidth;
  card.classList.add("card-fade");
}

function sheet(state) {
  const title = document.getElementById("sheet-name");
  const sub = document.getElementById("sheet-sub");
  if (!title || !sub) return;
  fadeCard();
  let heading = "Tap where you parked";
  let note = "";
  let enabled = false;
  if (state?.mode === "pick-lot") {
    heading = state.pin.name || "Trailhead";
    note = "Tap the blue P for the lot.";
  } else if (state?.mode === "trailhead") {
    heading = state.pin.name || "Trailhead";
    note = "Drop a pin on your spot.";
  } else if (state?.mode === "pin") {
    heading = state.pin.name;
    note = state.askTrail
      ? "No trail is tied to this lot yet."
      : (state.trailName && !state.pin.name.toLowerCase().includes(state.trailName.toLowerCase().replace(/\s+trailhead$/i, ""))
        ? `Near ${state.trailName}`
        : "");
    enabled = true;
  } else if (state?.mode === "unnamed") {
    heading = state.trailName ? `Lot near ${state.trailName}` : "Unnamed parking lot";
    note = "No name yet.";
    enabled = true;
  } else if (state) {
    heading = "Pin dropped";
    note = state.trailName
      ? `Near ${state.trailName}. Drag the pin if the spot is off.`
      : "Drag the pin if the spot is off.";
    enabled = true;
  }
  title.textContent = heading;
  sub.textContent = note;
  sub.hidden = !note;
  setContinue(enabled);
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
  setBanner("map-note", "");
  focusOn(pin);

  const trailName = knownTrail(pin.lat, pin.lon, pin);
  if (pin.kind === "trailhead") {
    chosen = nearbyLots(pin).length > 0
      ? { mode: "pick-lot", pin, trailName }
      : { mode: "trailhead", pin, trailName, askTrail: false };
    sheet(chosen);
    return;
  }
  const askTrail = !trailName;
  if (pin.named) {
    chosen = { mode: "pin", pin, trailName, askTrail, trailTyped: "" };
    sheet(chosen);
    return;
  }
  chosen = {
    mode: "unnamed",
    pin,
    trailName,
    askTrail,
    typed: "",
    trailTyped: "",
  };
  sheet(chosen);
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

function drawPins(places) {
  clearPins();
  loaded = places;
  const groups = groupPins(places);
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
    const besideLot = isTrail && places.some(
      (other) =>
        other.kind === "parking"
        && map.distance([pin.lat, pin.lon], [other.lat, other.lon]) <= 80,
    );
    const marker = window.L.marker([pin.lat, pin.lon], {
      pane: isTrail ? "trailPins" : "lotPins",
      icon: makeIcon(kind, 0, besideLot),
      zIndexOffset: isTrail ? 0 : 400,
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
}

async function loadPins(keepNote = false) {
  const frame = document.getElementById("visit-map");
  if (!map || !frame || frame.offsetHeight < 40) return;
  if (!keepNote) soughtLabel = "";
  const token = ++loadToken;
  const bounds = map.getBounds();
  setBanner("searching-near", "Looking nearby", "is-wait");
  try {
    const payload = await getMapView({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    });
    if (token !== loadToken) return;
    if (payload.zoomed_out) {
      clearPins();
      setBanner("searching-near", "");
      const found = soughtLabel ? `${soughtLabel} is on the map. ` : "";
      setBanner("map-note", `${found}Zoom in to see trailheads and parking lots.`, "is-warn");
      return;
    }
    if (!keepNote) {
      setBanner("map-note", "");
    }
    const merged = mergePins(payload.places);
    drawPins(merged);
    if (merged.length === 0) {
      setBanner("searching-near", "");
      setBanner("map-note", emptyViewNote(), "is-warn");
    } else if (payload.searching_near) {
      setBanner("searching-near", `Near ${payload.searching_near}`);
    } else {
      setBanner("searching-near", "This area");
    }
  } catch (_err) {
    if (token !== loadToken) return;
    if (loaded.length > 0) {
      drawPins(loaded);
      return;
    }
    setBanner("searching-near", "");
    setBanner(
      "map-note",
      "OpenStreetMap is taking a moment to respond. You can still drop a pin, or enter lat, lon above.",
      "is-warn",
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
  const trailName = knownTrail(lat, lon, null);
  chosen = {
    mode: "name",
    lat,
    lon,
    typed: "",
    trailName,
    askTrail: !trailName,
    trailTyped: "",
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

async function search() {
  const input = document.getElementById("search-input");
  const text = input.value.trim();
  if (text.length < 2 || !map) return;

  const coordMatch = COORD_RE.exec(text);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lon = Number(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      loadToken++;
      setBanner("map-note", "");
      map.setView([lat, lon], 16);
      await loadPins(true);
      dropAt(lat, lon);
      return;
    }
  }

  const center = map.getCenter();
  setBanner("searching-near", "Searching", "is-wait");
  try {
    const payload = await searchMap(text, center.lat, center.lng);
    if (payload.places.length > 0) {
      loadToken++;
      soughtLabel = "";
      setBanner("map-note", "");
      const first = payload.places[0];
      map.setView([first.lat, first.lon], 16);
      drawPins(mergePins(payload.places));
      selectPin(first);
      return;
    }
    if (payload.moved) {
      loadToken++;
      clearSelection();
      soughtLabel = payload.moved.label;
      setBanner("map-note", "");
      map.setView([payload.moved.lat, payload.moved.lon], 13);
      await loadPins(true);
      return;
    }
    soughtLabel = "";
    setBanner("searching-near", "");
    setBanner(
      "map-note",
      `No place named "${text}" from here. Try the town nearby, or lat, lon such as 47.488, -121.724.`,
      "is-warn",
    );
  } catch (_err) {
    setBanner("searching-near", "");
    setBanner(
      "map-note",
      "Search is taking a moment. You can pan the map, or enter lat, lon, to mark the spot.",
      "is-warn",
    );
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
    setBanner("map-note", "Could not save that place right now. Please try again.", "is-warn");
    setContinue(true);
  }
}

export function render() {
  const chips = REGIONS.map(
    (region, idx) =>
      `<button type="button" class="region-chip" data-region="${idx}">${esc(region.label)}</button>`,
  ).join("");
  return `
    <div id="map-step">
    <h1>Where did you park?</h1>
    <div class="map-regions" aria-label="Popular areas">${chips}</div>
    <div class="map-search">
      <input id="search-input" type="search" placeholder="Trail, town, or 47.488, -121.724" autocomplete="off">
      <button type="button" id="search-button" class="secondary">Find</button>
    </div>
    <p id="map-note" class="map-note" hidden></p>
    <div class="map-frame">
      <div id="visit-map" class="map-canvas"></div>
      <p id="searching-near" class="map-place" hidden></p>
      <div class="map-key" aria-label="Map key">
        <span class="key-item">${markHtml("trail")} Trailhead</span>
        <span class="key-item">${markHtml("lot")} Parking</span>
      </div>
    </div>
    <button type="button" id="drop-pin-btn" class="drop-pin-btn">Drop a pin</button>
    <div id="map-sheet" class="map-sheet">
      <div id="sheet-name" class="sheet-title">Tap where you parked</div>
      <p id="sheet-sub" class="sheet-helper" hidden></p>
    </div>
    <div class="actions">
      <button type="button" class="back" id="back">&lt;&lt; Back</button>
      <button type="button" class="next" id="map-next" disabled>Continue</button>
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
}

export function mountMap(_root, go) {
  destroyMap();

  map = window.L.map("visit-map", {
    zoomControl: true,
    maxZoom: 19,
  }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);

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
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

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
    const frame = document.getElementById("visit-map");
    if (!map || !frame || frame.offsetHeight < 40) return false;
    map.invalidateSize();
    return true;
  }

  document.querySelectorAll("[data-region]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const region = REGIONS[Number(btn.dataset.region)];
      if (!region) return;
      loadToken++;
      expandedKeys.clear();
      expandedZoom = null;
      clearSelection();
      setBanner("map-note", "");
      map.setView([region.lat, region.lon], 13);
      loadPins();
    });
  });

  document.getElementById("search-button").addEventListener("click", search);
  document.getElementById("search-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      search();
    }
  });

  document.getElementById("drop-pin-btn").addEventListener("click", () => {
    droppingMode = !droppingMode;
    if (droppingMode) {
      clearDropped();
      chosen = null;
      fadeCard();
      document.getElementById("sheet-name").textContent = "Drop your pin";
      const sub = document.getElementById("sheet-sub");
      sub.textContent = "Tap the map on the exact spot where you parked.";
      sub.hidden = false;
      setContinue(false);
    } else if (!chosen) {
      sheet(null);
    }
    syncDropButton();
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
  loadPins();
}
