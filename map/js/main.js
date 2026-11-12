import maplibregl from "https://esm.sh/maplibre-gl@4.7.1?deps=maplibre-gl@4.7.1";
import { Protocol } from "https://esm.sh/pmtiles@4.1.0";
import layers from "https://esm.sh/protomaps-themes-base@4.5.0";
import {
  installGlobalLayoutRecovery,
  resetDocumentScroll,
  watchMapViewport,
} from "./viewport.js";

const SOURCE_ID = "basemap";
const DEFAULT_VIEW = { lng: -121.72, lat: 47.49, zoom: 9 };

const statusEl = document.getElementById("map-status");
const attribEl = document.getElementById("map-attrib");

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", isError);
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

/** MapLibre vector source URL: TileJSON as-is, or pmtiles:// for archives / local proxy. */
function vectorSourceUrl(rawUrl) {
  let url = String(rawUrl || "").trim();
  if (!url) throw new Error("Empty basemap URL");
  if (url.startsWith("pmtiles://") || isTileJsonUrl(url)) return url;
  if (url.startsWith("/")) {
    url = `${window.location.origin}${url}`;
  }
  if (isPmtilesArchiveUrl(url)) return `pmtiles://${url}`;
  // Assume TileJSON or other MapLibre-native source URL.
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

let map = null;

function resizeMap() {
  map?.resize();
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
      maxZoom: manifest.basemap?.maxzoom ?? 15,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      setStatus(
        manifest.basemap?.version
          ? `Basemap ${manifest.basemap.version} (dev preview)`
          : "Map ready",
      );
      if (attribEl && manifest.basemap?.url) {
        attribEl.textContent = "Tiles from Karwan manifest · swap via KARWAN_BASEMAP_URL";
      }
      resizeMap();
    });

    map.on("error", (event) => {
      const msg = event.error?.message || "Map error";
      setStatus(msg, true);
    });

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
