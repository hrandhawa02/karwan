import maplibregl from "https://esm.sh/maplibre-gl@4.7.1?deps=maplibre-gl@4.7.1";
import { Protocol } from "https://esm.sh/pmtiles@4.1.0";
import layers from "https://esm.sh/protomaps-themes-base@4.5.0";
import {
  installGlobalLayoutRecovery,
  resetDocumentScroll,
  watchMapViewport,
} from "./viewport.js";
import {
  FILTERS,
  KIND_COLOR,
  SELECTED_FILL,
  choiceSubtitle,
  choiceToSheetProps,
  clustersToGeoJSON,
  defaultFilters,
  fetchMapPlaces,
  fetchNearbyPlaces,
  filterIdForChoice,
  kindLabel,
  matchPlaceKey,
  parseCoordinates,
  placeFeatureKey,
  placesToGeoJSON,
  searchPlaces,
} from "./places.js";
import { markSvg, registerMarkImages } from "./marks.js";

const SOURCE_ID = "basemap";
const PLACES_SOURCE = "karwan-places";
const CLUSTER_SOURCE = "karwan-clusters";
const PLACES_LAYER = "karwan-places-icons";
const PLACES_FALLBACK = "karwan-places-fallback";
const CLUSTER_LAYER = "karwan-clusters-circles";
const CLUSTER_LABEL = "karwan-clusters-label";
const DEFAULT_VIEW = { lng: -121.72, lat: 47.49, zoom: 9 };
const SEARCH_ZOOM = 14;
const MAP_MAX_ZOOM = 18;
const SUGGEST_MS = 220;

const statusEl = document.getElementById("map-status");
const attribEl = document.getElementById("map-attrib");
const searchInput = document.getElementById("search-input");
const suggestEl = document.getElementById("search-suggest");
const sheetEl = document.getElementById("place-sheet");
const filtersEl = document.getElementById("map-filters");

let map = null;
let suggestTimer = null;
let suggestToken = 0;
let pinLoadToken = 0;
let placesReady = false;
let filters = defaultFilters();
let lastPlaces = [];
let lastCounts = {};
let clusterMode = false;
let selectedKey = null;
let pendingSelectChoice = null;
let searchAnchorKind = null;
let countsReady = false;

/** Keep pins inside the frame (avoid icons clipped on the map edge). */
function pinInFrame(lat, lon, padPx = 36) {
  if (!map || lat == null || lon == null) return false;
  const el = map.getContainer();
  const w = el?.clientWidth || 0;
  const h = el?.clientHeight || 0;
  if (w < padPx * 2 || h < padPx * 2) return true;
  const pt = map.project([lon, lat]);
  return (
    pt.x >= padPx
    && pt.x <= w - padPx
    && pt.y >= padPx
    && pt.y <= h - padPx
  );
}

function placesInFrame(places) {
  return (places || []).filter((pin) => pinInFrame(pin.lat, pin.lon));
}

/** Pill counts = pins actually drawn (same in-frame set), not the raw API box. */
function countsFromPlaces(places) {
  const counts = {};
  for (const pin of places || []) {
    const kind = pin.kind;
    if (!kind) continue;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function geoPlaces(places = lastPlaces) {
  return placesToGeoJSON(placesInFrame(places), filters, selectedKey);
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  if (!text) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.classList.remove("is-error");
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", isError);
}

function clearStatus() {
  setStatus("");
}

async function loadManifest() {
  const res = await fetch("/api/v1/map-manifest");
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  return res.json();
}

function isTileJsonUrl(url) {
  const clean = String(url || "").trim().split("?")[0];
  return clean.endsWith(".json");
}

function isPmtilesArchiveUrl(url) {
  const clean = String(url || "").trim().split("?")[0];
  return (
    clean.startsWith("pmtiles://")
    || clean.endsWith(".pmtiles")
    || clean.includes("/pmtiles/")
  );
}

function vectorSourceUrl(rawUrl) {
  let url = String(rawUrl || "").trim();
  if (!url) throw new Error("Empty basemap URL");
  if (url.startsWith("pmtiles://") || isTileJsonUrl(url)) return url;
  if (url.startsWith("/")) {
    url = `${window.location.origin}${url}`;
  }
  if (isPmtilesArchiveUrl(url)) return `pmtiles://${url}`;
  return url;
}

function buildStyle(manifest) {
  const basemap = manifest.basemap || {};
  const url = vectorSourceUrl(basemap.url);
  const theme = basemap.theme || "light";
  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${theme}`,
    sources: {
      [SOURCE_ID]: {
        type: "vector",
        url,
        attribution: "© OpenStreetMap · Protomaps",
      },
    },
    layers: layers(SOURCE_ID, theme),
  };
}

function resizeMap() {
  map?.resize();
}

function sheetPadding() {
  if (!sheetEl || sheetEl.hidden) {
    return { top: 80, bottom: 40, left: 40, right: 40 };
  }
  const h = sheetEl.getBoundingClientRect().height || 160;
  return { top: 100, bottom: Math.round(h + 24), left: 40, right: 40 };
}

function flyToPoint(lon, lat, zoom) {
  if (!map) return;
  map.flyTo({
    center: [lon, lat],
    zoom,
    essential: true,
    padding: sheetPadding(),
  });
}

function kmBetween(aLat, aLon, bLat, bLon) {
  const dy = (aLat - bLat) * 111;
  const dx = (aLon - bLon) * 111 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function nearestParkingPins(places, choice, limit = 3, maxKm = 8) {
  return (places || [])
    .filter((pin) => pin.kind === "parking" && pin.lat != null && pin.lon != null)
    .map((pin) => ({
      pin,
      d: kmBetween(choice.lat, choice.lon, pin.lat, pin.lon),
    }))
    .filter(({ d }) => d <= maxKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ pin }) => pin);
}

/**
 * Land on the typeahead hit at pin zoom (highlighted). Optionally nudge to
 * include the nearest lot — never zoom out into cluster mode.
 */
function frameSearchArea(choice, nearPlaces) {
  if (!map || !choice) return;
  const parking = nearestParkingPins(nearPlaces, choice, 2, 8);
  if (!parking.length) {
    flyToPoint(choice.lon, choice.lat, SEARCH_ZOOM);
    return;
  }
  const bounds = new maplibregl.LngLatBounds(
    [choice.lon, choice.lat],
    [choice.lon, choice.lat],
  );
  for (const pin of parking) {
    bounds.extend([pin.lon, pin.lat]);
  }
  const cam = map.cameraForBounds(bounds, {
    padding: sheetPadding(),
    maxZoom: SEARCH_ZOOM,
  });
  // fitBounds padding can leave the view too wide → clusters. Stay on the hit.
  if (!cam || cam.zoom == null || cam.zoom < 12.5) {
    flyToPoint(choice.lon, choice.lat, SEARCH_ZOOM);
    return;
  }
  map.easeTo({
    center: cam.center,
    zoom: cam.zoom,
    bearing: cam.bearing ?? 0,
    padding: sheetPadding(),
    essential: true,
  });
}

/** Ensure the search hit exists as a pin so selection highlight can show. */
function withSearchAnchorPin(choice, places) {
  const list = [...(places || [])];
  const kind = filterIdForChoice(choice);
  if (!choice || !kind || choice.kind === "pin") return list;
  const matched = list.some((pin) => {
    if (pin.kind !== kind) return false;
    return kmBetween(choice.lat, choice.lon, pin.lat, pin.lon) < 0.35;
  });
  if (matched) return list;
  list.unshift({
    kind,
    name: choice.label || kindLabel(kind),
    lat: choice.lat,
    lon: choice.lon,
    osm_type: "search",
    osm_id: `${choice.lat},${choice.lon}`,
  });
  return list;
}

function hideSuggest() {
  if (!suggestEl) return;
  suggestEl.hidden = true;
  suggestEl.replaceChildren();
}

function showSuggest(choices) {
  if (!suggestEl) return;
  suggestEl.replaceChildren();
  if (!choices.length) {
    hideSuggest();
    return;
  }
  for (const choice of choices.slice(0, 8)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-suggest-item";
    const title = document.createElement("span");
    title.className = "search-suggest-title";
    title.textContent = choice.label || "Place";
    btn.append(title);
    const sub = choiceSubtitle(choice);
    if (sub) {
      const detail = document.createElement("span");
      detail.className = "search-suggest-detail";
      detail.textContent = sub;
      btn.append(detail);
    }
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      void selectChoice(choice);
    });
    suggestEl.append(btn);
  }
  suggestEl.hidden = false;
}

function hideSheet() {
  if (!sheetEl) return;
  sheetEl.hidden = true;
  sheetEl.replaceChildren();
  document.body.classList.remove("sheet-open");
  selectedKey = null;
  pendingSelectChoice = null;
  searchAnchorKind = null;
  if (placesReady && !clusterMode) {
    map?.getSource(PLACES_SOURCE)?.setData(geoPlaces());
  }
  resizeMap();
}

function showSheet(props) {
  if (!sheetEl) return;
  sheetEl.replaceChildren();
  const label = kindLabel(props.kind);
  const title = String(props.name || "").trim() || label;

  const top = document.createElement("div");
  top.className = "place-sheet-top";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "place-sheet-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", hideSheet);
  const copy = document.createElement("div");
  copy.className = "place-sheet-copy";
  const h = document.createElement("h2");
  h.className = "place-sheet-title";
  h.textContent = title;
  const bits = [];
  // Don't repeat “Lots / Lots” when the title is already the kind label.
  if (title !== label) bits.push(label);
  if (props.fee) bits.push(`Fee: ${props.fee}`);
  if (props.toilets === "1" || props.toilets === "true" || props.toilets === "yes") {
    bits.push("Toilets listed");
  }
  if (props.toilets === "0" || props.toilets === "false" || props.toilets === "no") {
    bits.push("No toilets listed");
  }
  if (bits.length) {
    const meta = document.createElement("p");
    meta.className = "place-sheet-meta";
    meta.textContent = bits.join(" · ");
    copy.append(h, meta);
  } else {
    copy.append(h);
  }
  top.append(dismiss, copy);
  sheetEl.append(top);
  sheetEl.hidden = false;
  document.body.classList.add("sheet-open");
  resizeMap();
}

function applyFiltersForSearch(choice) {
  filters = defaultFilters();
  const id = filterIdForChoice(choice);
  if (id && id !== "parking" && id !== "trailhead") {
    filters[id] = true;
  }
  if (choice.kind === "pin" && choice.pin?.kind === "parking") {
    filters.parking = true;
  }
  if (choice.kind === "pin" && choice.pin?.kind === "trailhead") {
    filters.trailhead = true;
    filters.parking = true;
  }
  // Always keep lots + trailheads for “where do I park?”
  filters.parking = true;
  filters.trailhead = true;
  syncFilterPills();
}

function countFor(id) {
  const n = lastCounts[id];
  return Number.isFinite(n) ? n : 0;
}

function pillLabel(id, label) {
  const count = countFor(id);
  return count > 0 ? `${label} ${count}` : label;
}

/** Drop selected kinds with nothing in view (no “Trailhead 0”). */
function pruneEmptyFilters() {
  if (!countsReady) return;
  for (const [id] of FILTERS) {
    if (id === searchAnchorKind) continue;
    if (filters[id] && countFor(id) === 0) filters[id] = false;
  }
  if (searchAnchorKind) filters[searchAnchorKind] = true;
  if (FILTERS.some(([id]) => filters[id])) return;
  if (countFor("parking") > 0) {
    filters.parking = true;
    return;
  }
  for (const [id] of FILTERS) {
    if (countFor(id) > 0) {
      filters[id] = true;
      return;
    }
  }
}

function ensureDefaultFilters() {
  if (FILTERS.some(([id]) => filters[id])) return;
  if (countsReady) {
    pruneEmptyFilters();
    return;
  }
  filters.parking = true;
  filters.trailhead = true;
}

function updatePillButton(btn, id, label) {
  const on = Boolean(filters[id]);
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const color = KIND_COLOR[id] || "#5e6b65";
  btn.style.setProperty("--pill-accent", color);
  const text = btn.querySelector(".filter-pill-text");
  if (text) text.textContent = pillLabel(id, label);
  btn.classList.toggle("is-empty", countFor(id) === 0);
}

function syncFilterPills() {
  if (!filtersEl) return;
  pruneEmptyFilters();
  ensureDefaultFilters();

  // Update in place when possible (avoids wiping selection chrome on every pan).
  if (filtersEl.childElementCount === FILTERS.length) {
    for (const [id, label] of FILTERS) {
      const btn = filtersEl.querySelector(`[data-kind="${id}"]`);
      if (btn) updatePillButton(btn, id, label);
    }
    return;
  }

  filtersEl.replaceChildren();
  for (const [id, label] of FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-pill";
    btn.dataset.kind = id;
    const icon = document.createElement("span");
    icon.className = "filter-pill-icon";
    icon.innerHTML = markSvg(id);
    const text = document.createElement("span");
    text.className = "filter-pill-text";
    btn.append(icon, text);
    updatePillButton(btn, id, label);
    btn.addEventListener("click", () => {
      void onFilterPillClick(id);
    });
    filtersEl.append(btn);
  }
}

/** Zoom in until the API returns pins (not clusters) so filters can show icons. */
async function zoomInForPins() {
  if (!map) return;
  for (let i = 0; i < 8; i += 1) {
    if (!clusterMode) return;
    const next = Math.min((map.getZoom() || 0) + 1.25, MAP_MAX_ZOOM);
    if (next <= (map.getZoom() || 0) + 0.01) return;
    await new Promise((resolve) => {
      map.once("moveend", () => resolve());
      map.easeTo({ zoom: next, duration: 220, essential: true });
    });
    await refreshPins();
  }
}

async function onFilterPillClick(id) {
  // Don't select a kind that has nothing in the current view.
  if (!filters[id] && countsReady && countFor(id) === 0 && !clusterMode) {
    return;
  }
  filters[id] = !filters[id];
  if (!FILTERS.some(([kind]) => filters[kind])) {
    if (countFor("parking") > 0 || !countsReady) filters.parking = true;
    else pruneEmptyFilters();
  }
  syncFilterPills();
  if (clusterMode) {
    await zoomInForPins();
  }
  renderPlaces();
}

function renderPlaces() {
  if (!map || !placesReady) return;
  if (clusterMode) {
    map.getSource(PLACES_SOURCE).setData(geoPlaces([]));
    clearStatus();
    return;
  }
  const visible = placesInFrame(lastPlaces);
  lastCounts = countsFromPlaces(visible);
  countsReady = true;
  syncFilterPills();
  map.getSource(PLACES_SOURCE).setData(
    placesToGeoJSON(visible, filters, selectedKey),
  );
  clearStatus();
}

function selectPlaceFeature(feature) {
  if (!feature) return;
  const props = feature.properties || {};
  const [lon, lat] = feature.geometry.coordinates;
  selectedKey = placeFeatureKey({
    osm_type: props.osm_type,
    osm_id: props.osm_id,
    lat,
    lon,
  });
  pendingSelectChoice = null;
  showSheet({
    kind: props.kind,
    name: props.name,
    fee: props.fee || "",
    toilets: props.toilets || "",
  });
  renderPlaces();
  flyToPoint(lon, lat, Math.max(map.getZoom(), 14));
}

function setClusterData(clusters) {
  if (!map?.getSource(CLUSTER_SOURCE)) return;
  const inset = (clusters || []).filter((cell) => pinInFrame(cell.lat, cell.lon, 40));
  map.getSource(CLUSTER_SOURCE).setData(clustersToGeoJSON(inset));
}

function clearClusters() {
  setClusterData([]);
  clusterMode = false;
}

function ensurePlacesLayer() {
  if (!map || map.getSource(PLACES_SOURCE)) return;

  map.addSource(PLACES_SOURCE, {
    type: "geojson",
    data: geoPlaces([]),
  });
  map.addSource(CLUSTER_SOURCE, {
    type: "geojson",
    data: clustersToGeoJSON([]),
  });

  const colorExpr = ["match", ["get", "kind"]];
  for (const [id, color] of Object.entries(KIND_COLOR)) {
    colorExpr.push(id, color);
  }
  colorExpr.push("#5e6b65");

  // Fallback dots if an icon image is missing (always under icons).
  map.addLayer({
    id: PLACES_FALLBACK,
    type: "circle",
    source: PLACES_SOURCE,
    paint: {
      "circle-radius": 8,
      "circle-color": [
        "case",
        ["==", ["get", "selected"], "yes"],
        SELECTED_FILL,
        colorExpr,
      ],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Selected pin uses survey terracotta mark (same size), not a bigger halo.
  map.addLayer({
    id: PLACES_LAYER,
    type: "symbol",
    source: PLACES_SOURCE,
    layout: {
      "icon-image": [
        "case",
        ["==", ["get", "selected"], "yes"],
        ["concat", "karwan-mark-v4-", ["get", "kind"], "-sel"],
        ["concat", "karwan-mark-v4-", ["get", "kind"]],
      ],
      "icon-size": 1,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "center",
    },
  });

  map.addLayer({
    id: CLUSTER_LAYER,
    type: "circle",
    source: CLUSTER_SOURCE,
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["get", "count"],
        1, 14,
        50, 22,
        200, 30,
      ],
      "circle-color": "#17211c",
      "circle-opacity": 0.85,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: CLUSTER_LABEL,
    type: "symbol",
    source: CLUSTER_SOURCE,
    layout: {
      "text-field": ["to-string", ["get", "count"]],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  placesReady = true;
  for (const id of [PLACES_FALLBACK, PLACES_LAYER, CLUSTER_LAYER, CLUSTER_LABEL]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }

  for (const layerId of [PLACES_LAYER, PLACES_FALLBACK]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("click", layerId, (event) => {
      selectPlaceFeature(event.features?.[0]);
    });
  }

  map.on("mouseenter", CLUSTER_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", CLUSTER_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", CLUSTER_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const [lon, lat] = feature.geometry.coordinates;
    const nextZoom = Math.min((map.getZoom() || 5) + 2, MAP_MAX_ZOOM);
    flyToPoint(lon, lat, nextZoom);
  });
}

async function refreshPins() {
  if (!map || !placesReady) return;
  const token = ++pinLoadToken;
  try {
    const payload = await fetchMapPlaces(map.getBounds());
    if (token !== pinLoadToken) return;
    if (payload.unavailable) {
      clearClusters();
      lastPlaces = [];
      lastCounts = {};
      countsReady = true;
      syncFilterPills();
      map.getSource(PLACES_SOURCE).setData(geoPlaces([]));
      setStatus("Places unavailable here (need outdoors.db locally, or catalog later)");
      return;
    }

    const clusters = payload.clusters || [];
    const places = payload.places || [];
    if (payload.zoomed_out || (clusters.length > 0 && places.length === 0)) {
      clusterMode = true;
      lastPlaces = [];
      lastCounts = payload.counts || {};
      countsReady = true;
      syncFilterPills();
      map.getSource(PLACES_SOURCE).setData(geoPlaces([]));
      setClusterData(clusters);
      clearStatus();
      return;
    }

    clearClusters();
    lastPlaces = places;
    if (pendingSelectChoice) {
      selectedKey = matchPlaceKey(pendingSelectChoice, places) || selectedKey;
      pendingSelectChoice = null;
    }
    // renderPlaces recounts from in-frame pins (fixes Bike 4 vs 3 icons).
    renderPlaces();
  } catch (err) {
    if (token !== pinLoadToken) return;
    setStatus(err.message || "Could not load places", true);
  }
}

async function settleSearchPins(choice) {
  await refreshPins();
  // Typeahead must land on pins + highlight, never a cluster overview.
  if (clusterMode) await zoomInForPins();
  lastPlaces = withSearchAnchorPin(choice, lastPlaces);
  selectedKey = matchPlaceKey(choice, lastPlaces) || selectedKey;
  pendingSelectChoice = null;
  renderPlaces();
}

async function selectChoice(choice) {
  hideSuggest();
  if (!map || !choice) return;
  if (searchInput) searchInput.value = choice.label || "";
  searchInput?.blur();
  applyFiltersForSearch(choice);
  searchAnchorKind = filterIdForChoice(choice);
  pendingSelectChoice = choice;
  selectedKey = choice.kind === "pin" && choice.pin
    ? placeFeatureKey(choice.pin)
    : placeFeatureKey({ lat: choice.lat, lon: choice.lon });
  showSheet(choiceToSheetProps(choice));

  const afterMove = () => {
    map.once("moveend", () => {
      void settleSearchPins(choice);
    });
  };

  // Direct pin (lot/trailhead): zoom tight.
  if (choice.kind === "pin") {
    afterMove();
    flyToPoint(choice.lon, choice.lat, 16);
    return;
  }

  // Peak / trail / activity: go to the hit first; nearby lots only if they fit.
  try {
    const payload = await fetchNearbyPlaces(choice.lat, choice.lon);
    const near = payload.places || [];
    afterMove();
    frameSearchArea(choice, near);
  } catch {
    afterMove();
    flyToPoint(choice.lon, choice.lat, SEARCH_ZOOM);
  }
}

async function runSearch(text) {
  const query = String(text || "").trim();
  if (query.length < 2 || !map) {
    hideSuggest();
    return;
  }
  const coords = parseCoordinates(query);
  if (coords) {
    hideSuggest();
    filters = defaultFilters();
    syncFilterPills();
    hideSheet();
    flyToPoint(coords.lon, coords.lat, 16);
    map.once("moveend", () => {
      void refreshPins();
    });
    return;
  }
  const token = ++suggestToken;
  const center = map.getCenter();
  try {
    const choices = await searchPlaces(query, center.lat, center.lng);
    if (token !== suggestToken) return;
    if (!choices.length) {
      hideSuggest();
      setStatus(`Nothing matched “${query}”`);
      return;
    }
    showSuggest(choices);
  } catch (err) {
    if (token !== suggestToken) return;
    hideSuggest();
    setStatus(err.message || "Search failed", true);
  }
}

function scheduleSuggest() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => {
    void runSearch(searchInput?.value);
  }, SUGGEST_MS);
}

function wireSearch() {
  if (!searchInput) return;
  searchInput.addEventListener("input", scheduleSuggest);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSuggest();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(suggestTimer);
      const first = suggestEl?.querySelector(".search-suggest-item");
      if (first && !suggestEl.hidden) {
        first.dispatchEvent(new Event("mousedown"));
        return;
      }
      void (async () => {
        await runSearch(searchInput.value);
        const next = suggestEl?.querySelector(".search-suggest-item");
        if (next && suggestEl && !suggestEl.hidden) {
          next.dispatchEvent(new Event("mousedown"));
        }
      })();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".search-wrap")) return;
    hideSuggest();
  });
}

async function start() {
  setStatus("Loading map…");
  try {
    const manifest = await loadManifest();
    const sourceUrl = vectorSourceUrl(manifest.basemap?.url);
    if (sourceUrl.startsWith("pmtiles://")) {
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
    }

    map = new maplibregl.Map({
      container: "map",
      style: buildStyle(manifest),
      center: [DEFAULT_VIEW.lng, DEFAULT_VIEW.lat],
      zoom: DEFAULT_VIEW.zoom,
      // Basemap tiles stop earlier; allow overzoom so pins stay usable up close.
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      void (async () => {
        try {
          await registerMarkImages(map, FILTERS.map(([id]) => id));
        } catch (err) {
          console.error(err);
          setStatus("Could not load pin icons", true);
        }
        ensurePlacesLayer();
        syncFilterPills();
        clearStatus();
        if (attribEl) {
          attribEl.textContent = "Tap a pin for details";
        }
        resizeMap();
        void refreshPins();
      })();
    });

    map.on("moveend", () => {
      void refreshPins();
    });

    map.on("error", (event) => {
      const msg = event.error?.message || "Map error";
      setStatus(msg, true);
    });

    wireSearch();
    watchMapViewport(resizeMap);
    installGlobalLayoutRecovery(resizeMap);
    window.addEventListener("resize", resizeMap);
    resetDocumentScroll();
  } catch (err) {
    setStatus(err.message || "Could not start map", true);
    console.error(err);
  }
}

start();
