import { actions, choices } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>Day trip or overnight?</h1>
    <p class="hint">Overnight means a car stayed at the trailhead past that day.</p>
    ${choices("stay", options("stay"), currentVisit.answers.stay)}
    ${actions("Next >>")}
  `;
}
