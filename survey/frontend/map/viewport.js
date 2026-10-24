/** iOS Safari: align map step to visualViewport; reset scroll when keyboard closes. */

let viewportHandler = null;

export function resetDocumentScroll() {
  window.scrollTo(0, 0);
  document.documentElement.scrollLeft = 0;
  document.documentElement.scrollTop = 0;
  document.body.scrollLeft = 0;
  document.body.scrollTop = 0;
}

export function clearViewportVars() {
  const root = document.documentElement;
  root.style.removeProperty("--view-height");
  root.style.removeProperty("--view-top");
  root.style.removeProperty("--view-left");
  root.style.removeProperty("--view-width");
}

function keyboardLikelyClosed(view) {
  if (!view) return true;
  const fullH = window.innerHeight;
  if (fullH < 1) return true;
  return view.height >= fullH * 0.9 && view.offsetTop <= 1 && view.offsetLeft <= 1;
}

function applyViewportVars() {
  const view = window.visualViewport;
  const root = document.documentElement;
  const height = Math.round(view?.height ?? window.innerHeight);
  const top = Math.round(view?.offsetTop ?? 0);
  const left = Math.round(view?.offsetLeft ?? 0);
  const width = Math.round(view?.width ?? window.innerWidth);
  const prev = root.style.getPropertyValue("--view-height");
  root.style.setProperty("--view-height", `${height}px`);
  root.style.setProperty("--view-top", `${top}px`);
  root.style.setProperty("--view-left", `${left}px`);
  root.style.setProperty("--view-width", `${width}px`);
  if (keyboardLikelyClosed(view)) {
    resetDocumentScroll();
  }
  return prev !== `${height}px`;
}

export function syncMapViewport(onLayoutChange) {
  const heightChanged = applyViewportVars();
  if (heightChanged) onLayoutChange?.();
}

export function watchMapViewport(onLayoutChange) {
  unwatchMapViewport();
  const handler = () => syncMapViewport(onLayoutChange);
  handler();
  const view = window.visualViewport;
  view?.addEventListener("resize", handler);
  view?.addEventListener("scroll", handler);
  viewportHandler = handler;
}

export function unwatchMapViewport() {
  if (viewportHandler) {
    window.visualViewport?.removeEventListener("resize", viewportHandler);
    window.visualViewport?.removeEventListener("scroll", viewportHandler);
    viewportHandler = null;
  }
  clearViewportVars();
  document.body.classList.remove("map-typing");
}

/** After keyboard / typeahead closes; does not touch the map or API. */
export function settleMapChrome() {
  document.body.classList.remove("map-typing");
  requestAnimationFrame(() => {
    applyViewportVars();
    resetDocumentScroll();
    requestAnimationFrame(resetDocumentScroll);
  });
}

export function installGlobalLayoutRecovery() {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearViewportVars();
      resetDocumentScroll();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!document.body.classList.contains("on-map-step")) {
      clearViewportVars();
    }
    resetDocumentScroll();
  });
}
