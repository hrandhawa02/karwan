import { actions, choices } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>How were the bathrooms?</h1>
    ${choices(
      "bathroomCondition",
      options("condition"),
      currentVisit.answers.bathroomCondition,
    )}
    ${actions("Next >>")}
  `;
}
