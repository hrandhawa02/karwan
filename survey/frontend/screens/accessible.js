import { actions, choices } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>Were there accessible parking spaces?</h1>
    <p class="hint">Marked spaces. Not how many, and not whether you used one.</p>
    ${choices("accessible", options("accessible"), currentVisit.answers.accessible)}
    ${actions("Next >>")}
  `;
}
