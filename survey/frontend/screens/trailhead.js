import { actions, esc } from "../buttons.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  const trailhead = currentVisit.trailhead;
  const facts = trailhead.facts.map((fact) => `<li>${esc(fact)}</li>`).join("");
  const intro = trailhead.sample
    ? `Sample trailhead near ${esc(trailhead.searching_near)}, so these questions can be tried. A map comes next.`
    : `Near ${esc(trailhead.searching_near)}.`;
  return `
    <p class="copy">${intro}</p>
    <h1>What we already know</h1>
    <ul class="facts">${facts}</ul>
    ${actions("Next >>")}
  `;
}
