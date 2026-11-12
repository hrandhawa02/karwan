/** Map pin marks (SVG → MapLibre images). Fills follow KIND_COLOR; selected = survey terracotta. */

import { KIND_COLOR, SELECTED_FILL } from "./places.js";

const HIKE_BOOT = `<g transform="translate(5.1 2.6) scale(0.585) rotate(-5 18 18)"><path fill="#fff" d="M34.469 28.156c-.59-.885-2.458-2.365-4.5-2.656-2.112-.302-3.877.18-6.571-1.394-.086-.066-.171-.131-.273-.19-2.153-1.247-5.917-5.417-6-9.542-.047-2.336-3-2.625-5.375-2.333-2.375.292-10.083 2.083-9.792 3.25.248.991.224 5.316-.018 8.205-.366 2.27-.636 5.435-.636 7.44C1.303 31.599 2.333 32 2.333 32l14.198.5 17.688-.477s.933-.084.906-.711c-.042-.958-.156-2.406-.656-3.156z"/><path fill="#fff" d="M1.334 31.216c.787.175 2.201.662 4.591.7 2.755.044 5.187-.525 8.308-.525 2.991 0 6.9.848 10.319.7 3.487-.152 7.35-.652 8.192-.799 1.667-.292 2.438-.479 2.438-.479s.365-.021.531.688c.167.708.304 2.083-.841 2.427-2.186.656-7.554 1.113-12.724 1.049-2.626-.032-5.549-.81-6.966-.976-1.417-.167-2.667-.287-3.062 0-.396.287.089.792-.946.933-2.58.35-8.614.044-9.928-.516-.672-.286-1.051-3.455.088-3.202z"/></g>`;

const WALK = `<circle cx="14" cy="8.4" r="2.05" fill="#fff"/><path d="M14 10.6v4.6M14 13l-3.2 5.2M14 13l4.2 4.8M14 11.6l-2.9 2.1M14 11.6l3.1 1.7" fill="none" stroke="#fff" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`;

function fillFor(kind) {
  return KIND_COLOR[kind] || "#5e6b65";
}

function circle(fill, inner) {
  return `<circle cx="14" cy="14" r="12.5" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>${inner}`;
}

function wrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 28 28">${inner}</svg>`;
}

/** Inner SVG content (no root) per place kind. */
export function markInner(kind, selected = false) {
  const fill = selected ? SELECTED_FILL : fillFor(kind);
  if (kind === "parking") {
    return `<rect x="2.5" y="2.5" width="23" height="23" rx="6" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/><path d="M10.5 19.5V8.5h4.6c2.2 0 3.6 1.3 3.6 3.3 0 2.1-1.4 3.4-3.6 3.4h-2.3v4.3h-2.3zm2.3-6.2h2c1 0 1.6-.6 1.6-1.5 0-.9-.6-1.4-1.6-1.4h-2v2.9z" fill="#ffffff"/>`;
  }
  if (kind === "trailhead") {
    return circle(
      fill,
      `<path d="M13.2 7.2h1.6V21" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/><path d="M14.6 8.2h6.2l-1.15 2.15 1.15 2.15h-6.2z" fill="#ffffff"/>`,
    );
  }
  if (kind === "hike") return circle(fill, HIKE_BOOT);
  if (kind === "bike") {
    return circle(
      fill,
      `<circle cx="9.2" cy="18.2" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="19" cy="18.2" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M9.2 18.2 12.6 11.4h4.6l2.2 6.8M12.6 11.4 15.4 18.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  if (kind === "ski") {
    return circle(
      fill,
      `<path d="M9.8 7.8v12.8" fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round"/><path d="M17.6 8.2v12.2" fill="none" stroke="#fff" stroke-width="2.35" stroke-linecap="round"/>`,
    );
  }
  if (kind === "climb") {
    return circle(fill, `<path d="M7.5 20.5 14 6.8l2.3 5.2 4.7 8.5Z" fill="#fff"/>`);
  }
  if (kind === "foot") return circle(fill, WALK);
  if (kind === "camp") {
    return circle(
      fill,
      `<path d="M5.8 20.6 14 8.2l8.2 12.4H5.8z" fill="#fff"/><path d="M14 8.6v12" stroke="${fill}" stroke-width="1.3"/>`,
    );
  }
  if (kind === "shelter") {
    return circle(fill, `<path d="M6.2 13.4 14 7.2l7.8 6.2V21H6.2v-7.6z" fill="#fff"/>`);
  }
  if (kind === "peak") {
    return circle(fill, `<path d="M5.5 20.5 11 9.2l3.2 5.4L18.2 8 22.5 20.5Z" fill="#fff"/>`);
  }
  if (kind === "range") {
    return circle(
      fill,
      `<circle cx="14" cy="14" r="5.2" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="2.5" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="0.9" fill="#fff"/>`,
    );
  }
  if (kind === "viewpoint") {
    return circle(
      fill,
      `<circle cx="14" cy="14" r="3.3" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="14" cy="14" r="1.15" fill="#fff"/><path d="M14 6.8v2.3M14 18.9v2.3M6.8 14h2.3M18.9 14h2.3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }
  if (kind === "beach") {
    return circle(
      fill,
      `<path d="M5 19.5h18" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M6.5 19.5c1.5-2.8 3.5-4.2 7.5-4.2s6 1.4 7.5 4.2" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`,
    );
  }
  if (kind === "picnic") {
    return circle(
      fill,
      `<path d="M8 12h12M14 12V8.5M10.5 8.5h7" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M9 12 7.5 19M19 12l1.5 7" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`,
    );
  }
  if (kind === "hot_spring") {
    return circle(
      fill,
      `<path d="M10 18c0-3 2-5.5 4-8 2 2.5 4 5 4 8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 14.5c.8-1.2 1.5-2 2.5-2s1.7.8 2.5 2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`,
    );
  }
  if (kind === "lift") {
    return circle(
      fill,
      `<path d="M8 20V10l6-4 6 4v10" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="14" cy="11" r="1.3" fill="#fff"/>`,
    );
  }
  if (kind === "ranger") {
    return circle(
      fill,
      `<path d="M7 20V11l7-5 7 5v9" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><rect x="11.5" y="14" width="5" height="6" rx=".5" fill="#fff"/>`,
    );
  }
  if (kind === "boat") {
    return circle(
      fill,
      `<path d="M6 17h16l-2.5-4H8.5L6 17z" fill="#fff"/><path d="M14 8v5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  }
  if (kind === "horse") {
    return circle(
      fill,
      `<path d="M8 19c1.5-4 3-6 6-6s4.5 2 6 6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="12" r="1.4" fill="#fff"/>`,
    );
  }
  if (kind === "hut") {
    return circle(
      fill,
      `<path d="M8 20.4V12.6L14 8.2l6 4.4v7.8h-3.7v-4.5h-4.6v4.5H8z" fill="#fff"/>`,
    );
  }
  if (kind === "cave") {
    return circle(
      fill,
      `<path d="M7 18c0-4 3-8 7-8s7 4 7 8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }
  return circle(fill, `<circle cx="14" cy="14" r="3" fill="#fff"/>`);
}

export function markSvg(kind, selected = false) {
  return wrap(markInner(kind, selected));
}

export function markDataUrl(kind, selected = false) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markSvg(kind, selected))}`;
}

/** Versioned so color updates replace MapLibre cached images. */
export function imageIdForKind(kind, selected = false) {
  return selected ? `karwan-mark-v4-${kind}-sel` : `karwan-mark-v4-${kind}`;
}

const MARK_PX = 64;

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 48)}`));
    img.src = url;
  });
}

/**
 * MapLibre symbol layers need raster images (PNG-like ImageData).
 * Survey SVGs are drawn to a canvas first — raw SVG data-URLs are flaky.
 */
async function rasterizeSvg(svgText, size = MARK_PX) {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadHtmlImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadOne(map, kind, selected = false) {
  const id = imageIdForKind(kind, selected);
  if (map.hasImage(id)) return;
  const data = await rasterizeSvg(markSvg(kind, selected));
  if (!map.hasImage(id)) {
    map.addImage(id, data, { pixelRatio: 2 });
  }
}

/** Register normal + selected (survey highlight) marks. */
export async function registerMarkImages(map, kinds) {
  for (const kind of kinds) {
    await loadOne(map, kind, false);
    await loadOne(map, kind, true);
  }
}
