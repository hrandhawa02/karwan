import { actions, choices } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>Did this lot require payment to park?</h1>
    <p class="hint">This is about the lot, not whether you paid. Choose Yes if parking costs money, even when you already had a pass and did not pay that day.</p>
    ${choices("payRequired", options("payRequired"), currentVisit.answers.payRequired)}
    ${actions("Next >>")}
  `;
}
