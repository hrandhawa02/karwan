import { actions, esc } from "../buttons.js";
import { arrivalInRange, earliestArrival, nowInZone } from "../clock.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  const trailhead = currentVisit.trailhead;
  const start = currentVisit.answers.hikeStart;
  const inRange = arrivalInRange(start, trailhead.timezone);
  const zone = trailhead.zone_label;
  let hint = `Set when you got there, in ${zone}. `
    + "Filling this in later, or from another country, "
    + "still uses that trailhead clock.";
  if (start && !inRange) {
    hint = `Choose a time from 2024 through now, in ${zone}.`;
  }
  return `
    <h1 id="q">What time did you get there?</h1>
    <p class="hint">${hint}</p>
    <input id="hike-start" type="datetime-local" aria-labelledby="q"
      min="${earliestArrival}" max="${esc(nowInZone(trailhead.timezone))}"
      value="${esc(start)}" required>
    ${actions("Next >>")}
  `;
}
