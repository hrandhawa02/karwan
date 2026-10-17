import { currentVisit } from "../current_visit.js";

export function loadingMessage() {
  if (currentVisit.trailhead) return "";
  if (!currentVisit.trailheadError) return "<h1>Loading the trailhead</h1>";
  return `<h1>The trailhead could not load.</h1>
    <p class="lede">Refresh the page and try again.</p>`;
}
