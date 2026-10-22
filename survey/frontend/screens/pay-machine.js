import { actions, checks } from "../buttons.js";
import { options } from "../labels.js";
import { currentVisit } from "../current_visit.js";

export function render() {
  return `
    <h1>How could someone pay to park?</h1>
    <p class="hint">This is about the lot, not whether you paid or already had a pass. Check every way someone could pay. I didn’t look stands on its own.</p>
    ${checks("payMachine", options("payMachine"), currentVisit.answers.payMachine)}
    ${actions("Note payment")}
  `;
}
