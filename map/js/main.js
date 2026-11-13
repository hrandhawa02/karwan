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
  fetchExplorePlaces,
  fetchNearbyPlaces,
  filterIdForChoice,
  kindLabel,
  matchPlaceKey,
  mergeClustersByScreen,
  parseCoordinates,
  placeFeatureKey,
  placesToGeoJSON,
  searchPlaces,
} from "./places.js";
import { markSvg, registerMarkImages } from "./marks.js";

const SOURCE_ID = "basemap";
const PLACES_SOURCE = "karwan-places";
const OVERVIEW_SOURCE = "karwan-overview-clusters";
const PLACES_LAYER = "karwan-places-icons";
const PLACES_FALLBACK = "karwan-places-fallback";
const SUPERCLUSTER_LAYER = "karwan-supercluster-circles";
const SUPERCLUSTER_LABEL = "karwan-supercluster-label";
const OVERVIEW_LAYER = "karwan-overview-circles";
const OVERVIEW_LABEL = "karwan-overview-label";

const DEFAULT_VIEW = { lng: -121.72, lat: 47.49, zoom: 9 };
const SEARCH_ZOOM = 14;
const MAP_MAX_ZOOM = 18;
const CLUSTER_MAX_ZOOM = 12;
const CLUSTER_RADIUS = 58;
const EXPLORE_SPAN_LIMIT = 3.8;
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
let loadedPlaces = [];
let loadedBox = null;
let loadedVersion = 0;
let lastSourceSig = "";
let lastCounts = {};
let overviewMode = false;
let selectedKey = null;
let pendingSelectChoice = null;
let searchAnchorKind = null;
let countsReady = false;

function countsInBounds(places, bounds) {
  const counts = {};
  if (!bounds) return counts;
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  for (const pin of places || []) {
    if (pin.lat == null || pin.lon == null || !pin.kind) continue;
    if (pin.lat < south || pin.lat > north || pin.lon < west || pin.lon > east) {
      continue;
    }
    counts[pin.kind] = (counts[pin.kind] || 0) + 1;
  }
  return counts;
}

function boxCoversBounds(box, bounds) {
  if (!box || !bounds) return false;
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  const marginLat = (north - south) * 0.12;
  const marginLon = (east - west) * 0.12;
  return (
    south - marginLat >= box.south
    && north + marginLat <= box.north
    && west - marginLon >= box.west
    && east + marginLon <= box.east
  );
}

function buildBufferedBox(bounds) {
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  const latSpan = north - south;
  const lonSpan = east - west;
  if (latSpan > EXPLORE_SPAN_LIMIT || lonSpan > EXPLORE_SPAN_LIMIT) {
    return { south, west, north, east, wide: true };
  }
  const padLat = Math.min(
    Math.max(latSpan * 0.45, 0.08),
    Math.max((EXPLORE_SPAN_LIMIT - latSpan) / 2, 0),
  );
  const padLon = Math.min(
    Math.max(lonSpan * 0.45, 0.1),
    Math.max((EXPLORE_SPAN_LIMIT - lonSpan) / 2, 0),
  );
  return {
    south: south - padLat,
    west: west - padLon,
    north: north + padLat,
    east: east + padLon,
    wide: false,
  };
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
    return { top: 60, bottom: 52, left: 48, right: 48 };
  }
  const h = sheetEl.getBoundingClientRect().height || 120;
  return { top: 64, bottom: Math.round(h + 32), left: 48, right: 48 };
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
  if (!cam || cam.zoom == null || cam.zoom < CLUSTER_MAX_ZOOM + 1) {
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
  syncPlacesSourceData();
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

function isPillVisuallyOn(id) {
  if (!filters[id]) return false;
  if (!countsReady || overviewMode || id === searchAnchorKind) return true;
  return countFor(id) > 0;
}

/** Ensure at least one visible category is active when the view has places. */
function ensureNonEmptyFilter() {
  if (!FILTERS.some(([id]) => filters[id])) {
    filters.parking = true;
    filters.trailhead = true;
  }
  if (!countsReady || overviewMode) return false;
  if (FILTERS.some(([id]) => filters[id] && (countFor(id) > 0 || id === searchAnchorKind))) {
    return false;
  }
  for (const [id] of FILTERS) {
    if (countFor(id) > 0) {
      filters[id] = true;
      return true;
    }
  }
  return false;
}

function updatePillButton(btn, id, label) {
  const on = isPillVisuallyOn(id);
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const color = KIND_COLOR[id] || "#5e6b65";
  btn.style.setProperty("--pill-accent", color);
  const text = btn.querySelector(".filter-pill-text");
  if (text) text.textContent = pillLabel(id, label);
  btn.classList.toggle("is-empty", countsReady && countFor(id) === 0);
}

function syncFilterPills() {
  if (!filtersEl) return false;
  const changed = ensureNonEmptyFilter();

  if (filtersEl.childElementCount === FILTERS.length) {
    for (const [id, label] of FILTERS) {
      const btn = filtersEl.querySelector(`[data-kind="${id}"]`);
      if (btn) updatePillButton(btn, id, label);
    }
    return changed;
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
  return changed;
}

function sourceSignature() {
  if (overviewMode) return "overview";
  const active = FILTERS.filter(([id]) => filters[id]).map(([id]) => id).join(",");
  return `${loadedVersion}|${active}|${selectedKey || ""}`;
}

/**
 * Push GeoJSON into MapLibre's Supercluster source ONLY when the point set,
 * active filters, or selected pin changed — never during zoom/pan inside
 * loadedBox. That keeps cluster drill-down counts 100% conserved.
 */
function syncPlacesSourceData(force = false) {
  if (!map || !placesReady) return;
  const src = map.getSource(PLACES_SOURCE);
  if (!src) return;
  const sig = sourceSignature();
  if (!force && sig === lastSourceSig) return;
  lastSourceSig = sig;
  if (overviewMode) {
    src.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  src.setData(placesToGeoJSON(loadedPlaces, filters, selectedKey));
}

async function onFilterPillClick(id) {
  const wasOn = isPillVisuallyOn(id);
  if (!wasOn && countsReady && !overviewMode && countFor(id) === 0) {
    return;
  }
  filters[id] = !wasOn;
  if (!FILTERS.some(([kind]) => filters[kind] && (overviewMode || !countsReady || countFor(kind) > 0))) {
    if (countFor("parking") > 0 || !countsReady || overviewMode) {
      filters.parking = true;
    } else {
      ensureNonEmptyFilter();
    }
  }
  syncFilterPills();
  syncPlacesSourceData(true);
  if (overviewMode && map) {
    map.easeTo({
      zoom: Math.max((map.getZoom() || 5) + 2, 8),
      essential: true,
    });
  }
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
  syncPlacesSourceData();
  flyToPoint(lon, lat, Math.max(map.getZoom(), 14));
}

function setOverviewClusters(clusters) {
  if (!map?.getSource(OVERVIEW_SOURCE)) return;
  const merged = mergeClustersByScreen(
    clusters || [],
    (lngLat) => map.project(lngLat),
    56,
  );
  map.getSource(OVERVIEW_SOURCE).setData(clustersToGeoJSON(merged));
}

function boundsFromFeatures(features) {
  let bounds = null;
  for (const feat of features || []) {
    const coords = feat?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    if (!bounds) {
      bounds = new maplibregl.LngLatBounds(coords, coords);
    } else {
      bounds.extend(coords);
    }
  }
  return bounds;
}

async function onSuperclusterClick(feature) {
  if (!map || !feature) return;
  const props = feature.properties || {};
  const clusterId = Number(props.cluster_id);
  const pointCount = Number(props.point_count) || 2;
  const [lon, lat] = feature.geometry.coordinates;
  const source = map.getSource(PLACES_SOURCE);
  if (!source || !Number.isFinite(clusterId)) return;

  try {
    const [expansionZoom, children, leaves] = await Promise.all([
      source.getClusterExpansionZoom(clusterId),
      source.getClusterChildren(clusterId),
      source.getClusterLeaves(clusterId, Math.min(pointCount, 500), 0),
    ]);
    const minSplitZoom = Math.min(expansionZoom + 0.12, MAP_MAX_ZOOM);
    const pad = sheetPadding();
    const leafBounds = boundsFromFeatures(leaves);
    const childBounds = boundsFromFeatures(children);

    if (leafBounds) {
      const leafCam = map.cameraForBounds(leafBounds, {
        padding: pad,
        maxZoom: 15.5,
      });
      if (leafCam && leafCam.zoom != null && leafCam.zoom >= minSplitZoom) {
        map.easeTo({
          center: leafCam.center,
          zoom: Math.min(leafCam.zoom, MAP_MAX_ZOOM),
          bearing: leafCam.bearing ?? 0,
          padding: pad,
          essential: true,
        });
        return;
      }
    }

    const center = childBounds ? childBounds.getCenter() : [lon, lat];
    map.easeTo({
      center,
      zoom: minSplitZoom,
      padding: pad,
      essential: true,
    });
  } catch {
    flyToPoint(lon, lat, Math.min((map.getZoom() || 9) + 1.5, MAP_MAX_ZOOM));
  }
}

function ensurePlacesLayer() {
  if (!map || map.getSource(PLACES_SOURCE)) return;

  map.addSource(PLACES_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: CLUSTER_RADIUS,
  });
  map.addSource(OVERVIEW_SOURCE, {
    type: "geojson",
    data: clustersToGeoJSON([]),
  });

  const colorExpr = ["match", ["get", "kind"]];
  for (const [id, color] of Object.entries(KIND_COLOR)) {
    colorExpr.push(id, color);
  }
  colorExpr.push("#5e6b65");

  // Unclustered fallback dots (under icons).
  map.addLayer({
    id: PLACES_FALLBACK,
    type: "circle",
    source: PLACES_SOURCE,
    filter: ["!", ["has", "point_count"]],
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

  // Unclustered pins (survey terracotta when selected).
  map.addLayer({
    id: PLACES_LAYER,
    type: "symbol",
    source: PLACES_SOURCE,
    filter: ["!", ["has", "point_count"]],
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

  // Native Supercluster bubbles (z7..z12).
  map.addLayer({
    id: SUPERCLUSTER_LAYER,
    type: "circle",
    source: PLACES_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["get", "point_count"],
        2, 16,
        20, 20,
        80, 24,
        300, 28,
      ],
      "circle-color": "#17211c",
      "circle-opacity": 0.9,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: SUPERCLUSTER_LABEL,
    type: "symbol",
    source: PLACES_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  // Multi-state overview bubbles (only when zoomed out past ~4° span).
  map.addLayer({
    id: OVERVIEW_LAYER,
    type: "circle",
    source: OVERVIEW_SOURCE,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["get", "count"],
        1, 16,
        50, 22,
        300, 28,
      ],
      "circle-color": "#17211c",
      "circle-opacity": 0.9,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: OVERVIEW_LABEL,
    type: "symbol",
    source: OVERVIEW_SOURCE,
    layout: {
      "text-field": ["to-string", ["get", "count"]],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  placesReady = true;
  for (const id of [
    PLACES_FALLBACK,
    PLACES_LAYER,
    SUPERCLUSTER_LAYER,
    SUPERCLUSTER_LABEL,
    OVERVIEW_LAYER,
    OVERVIEW_LABEL,
  ]) {
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

  map.on("mouseenter", SUPERCLUSTER_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", SUPERCLUSTER_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", SUPERCLUSTER_LAYER, (event) => {
    void onSuperclusterClick(event.features?.[0]);
  });

  map.on("mouseenter", OVERVIEW_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", OVERVIEW_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", OVERVIEW_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const [lon, lat] = feature.geometry.coordinates;
    map.easeTo({
      center: [lon, lat],
      zoom: Math.max((map.getZoom() || 5) + 2, 8),
      padding: sheetPadding(),
      essential: true,
    });
  });
}

function updateViewportCountsAndRender() {
  if (!map || !placesReady) return;
  lastCounts = countsInBounds(loadedPlaces, map.getBounds());
  countsReady = true;
  const filterAutoChanged = syncFilterPills();
  syncPlacesSourceData(filterAutoChanged);
  clearStatus();
}

async function refreshPins() {
  if (!map || !placesReady) return;
  const bounds = map.getBounds();

  // Reuse loadedPlaces when zooming/panning inside the buffered region!
  // This keeps Supercluster's KD-tree intact so cluster drill-down counts
  // never jump (no 172 -> 226 or 26 -> 25).
  if (!overviewMode && loadedBox && boxCoversBounds(loadedBox, bounds)) {
    if (pendingSelectChoice) {
      loadedPlaces = withSearchAnchorPin(pendingSelectChoice, loadedPlaces);
      loadedVersion += 1;
      selectedKey = matchPlaceKey(pendingSelectChoice, loadedPlaces) || selectedKey;
      pendingSelectChoice = null;
    }
    updateViewportCountsAndRender();
    return;
  }

  const reqBox = buildBufferedBox(bounds);
  const token = ++pinLoadToken;
  try {
    const payload = await fetchExplorePlaces(reqBox);
    if (token !== pinLoadToken) return;

    if (payload.unavailable) {
      overviewMode = false;
      loadedBox = null;
      loadedPlaces = [];
      loadedVersion += 1;
      lastCounts = {};
      countsReady = true;
      setOverviewClusters([]);
      syncFilterPills();
      syncPlacesSourceData(true);
      setStatus("Places unavailable here (need outdoors.db locally, or catalog later)");
      return;
    }

    const clusters = payload.clusters || [];
    const places = payload.places || [];
    if (payload.zoomed_out || (clusters.length > 0 && places.length === 0)) {
      overviewMode = true;
      loadedBox = null;
      loadedPlaces = [];
      loadedVersion += 1;
      lastCounts = payload.counts || {};
      countsReady = true;
      syncFilterPills();
      syncPlacesSourceData(true);
      setOverviewClusters(clusters);
      clearStatus();
      return;
    }

    overviewMode = false;
    setOverviewClusters([]);
    const [bs, bw, bn, be] = payload.box || [
      reqBox.south,
      reqBox.west,
      reqBox.north,
      reqBox.east,
    ];
    loadedBox = { south: bs, west: bw, north: bn, east: be };
    loadedPlaces = places;
    if (pendingSelectChoice) {
      loadedPlaces = withSearchAnchorPin(pendingSelectChoice, loadedPlaces);
      selectedKey = matchPlaceKey(pendingSelectChoice, loadedPlaces) || selectedKey;
      pendingSelectChoice = null;
    }
    loadedVersion += 1;
    updateViewportCountsAndRender();
  } catch (err) {
    if (token !== pinLoadToken) return;
    setStatus(err.message || "Could not load places", true);
  }
}

async function settleSearchPins(choice) {
  await refreshPins();
  if (overviewMode && map) {
    await new Promise((resolve) => {
      map.once("moveend", () => resolve());
      flyToPoint(choice.lon, choice.lat, SEARCH_ZOOM);
    });
    await refreshPins();
  }
  const next = withSearchAnchorPin(choice, loadedPlaces);
  if (next.length !== loadedPlaces.length) {
    loadedPlaces = next;
    loadedVersion += 1;
  }
  selectedKey = matchPlaceKey(choice, loadedPlaces) || selectedKey;
  pendingSelectChoice = null;
  updateViewportCountsAndRender();
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
  syncPlacesSourceData();

  const afterMove = () => {
    map.once("moveend", () => {
      void settleSearchPins(choice);
    });
  };

  if (choice.kind === "pin") {
    afterMove();
    flyToPoint(choice.lon, choice.lat, 16);
    return;
  }

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
