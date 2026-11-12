/** iOS Safari: optional fixed shell + scroll reset (MapLibre uses map.resize()). */

let viewportHandler = null;

export function resetDocumentScroll() {
  window.scrollTo(0, 0);
  document.documentElement.scrollLeft = 0;
  document.body.scrollLeft = 0;
}

export function clearViewportVars() {
  const root = document.documentElement;
  root.style.removeProperty("--view-height");
  root.style.removeProperty("--view-top");
  root.style.removeProperty("--view-left");
  root.style.removeProperty("--view-width");
}

function applyViewportVars() {
  const view = window.visualViewport;
  const root = document.documentElement;
  const height = Math.round(view?.height ?? window.innerHeight);
  const top = Math.round(view?.offsetTop ?? 0);
  const left = Math.round(view?.offsetLeft ?? 0);
  const width = Math.round(view?.width ?? window.innerWidth);
  root.style.setProperty("--view-height", `${height}px`);
  root.style.setProperty("--view-top", `${top}px`);
  root.style.setProperty("--view-left", `${left}px`);
  root.style.setProperty("--view-width", `${width}px`);
}

export function watchMapViewport(onLayoutChange) {
  unwatchMapViewport();
  document.documentElement.classList.add("map-viewport-lock");
  document.body.classList.add("map-viewport-lock");
  const handler = () => {
    applyViewportVars();
    onLayoutChange?.();
  };
  handler();
  window.visualViewport?.addEventListener("resize", handler);
  window.visualViewport?.addEventListener("scroll", handler);
  viewportHandler = handler;
}

export function unwatchMapViewport() {
  if (viewportHandler) {
    window.visualViewport?.removeEventListener("resize", viewportHandler);
    window.visualViewport?.removeEventListener("scroll", viewportHandler);
    viewportHandler = null;
  }
  document.documentElement.classList.remove("map-viewport-lock");
  document.body.classList.remove("map-viewport-lock");
  clearViewportVars();
}

export function installGlobalLayoutRecovery(resizeMap) {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearViewportVars();
      resetDocumentScroll();
      resizeMap?.();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resetDocumentScroll();
      resizeMap?.();
    }
  });
}
