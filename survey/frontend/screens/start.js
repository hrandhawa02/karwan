import { actions } from "../buttons.js";
import { currentVisit } from "../current_visit.js";

function legalLine(settle) {
  const settleClass = settle ? " settle" : "";
  return `
    <p class="legal${settleClass}">
      <a href="/privacy">Privacy</a>
      <span aria-hidden="true"> · </span>
      <a href="/terms">Terms</a>
      <span aria-hidden="true"> · </span>
      © 2026 Karwan
    </p>
  `;
}

export function render() {
  if (currentVisit.closed) {
    return `
      <h1>Notes open in 2027.</h1>
      <p class="copy">For the trail. From the people who were just there.</p>
      <p class="copy">
        A note about the cars, the pay machine, and the bathrooms.
      </p>
      <p class="copy">
        No name, no email, no phone number. No personal data is
        collected, stored, or marketed. Your note stays with Karwan.
      </p>
      ${legalLine(true)}
    `;
  }
  return `
    <h1>For the trail.</h1>
    <p class="copy">From the people who were just there.</p>
    <p class="copy">
      Tell the rest of us about the cars, the pay machine, and the bathrooms.
    </p>
    <p class="copy">A few questions. About a minute.</p>
    <p class="copy">
      The notes come first. <span class="name">Karwan</span> grows from them,
      once enough of us add a visit.
    </p>
    <p class="copy">
      No name, no email, no phone number. No personal data is
      collected, stored, or marketed. Your note stays with Karwan.
    </p>
    ${actions("Add a visit")}
    ${legalLine(false)}
  `;
}
