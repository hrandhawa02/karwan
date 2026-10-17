import { actions, choices } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>Were there bathrooms?</h1>
    ${choices("bathroomExists", options("bathroom"), currentVisit.answers.bathroomExists)}
    ${actions("Next >>")}
  `;
}
