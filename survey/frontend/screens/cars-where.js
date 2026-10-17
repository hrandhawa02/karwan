import { actions, checks } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>When you pulled in, what happened with parking?</h1>
    <p class="hint">Check every box that fits. I didn’t look stands on its own.</p>
    ${checks("carsWhere", options("carsWhere"), currentVisit.answers.carsWhere)}
    ${actions("Next >>")}
  `;
}
