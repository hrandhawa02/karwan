import { actions, scenePicture } from "../buttons.js";
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

function scenarios() {
  const lines = [
    ["Was the lot already full?", "/survey/scenes/park-full.jpg"],
    ["Was the pay machine down?", "/survey/scenes/pay-card.jpg"],
    ["Were the bathrooms open?", "/survey/scenes/bath-closed.jpg"],
  ];
  const items = lines.map(([line, image]) => `
    <li>
      <span>${line}</span>
      ${scenePicture(image, false)}
    </li>
  `).join("");
  return `<ul class="scenarios">${items}</ul>`;
}

function howSteps() {
  const steps = [
    ["1", "Pick the parking lot you used"],
    ["2", "Note if it was full, if the pay machine worked, and if the bathrooms were open"],
  ];
  const items = steps.map(([num, title]) => `
    <li>
      <span class="how-num">${num}</span>
      <span class="how-title">${title}</span>
    </li>
  `).join("");
  return `<ol class="how-row" aria-label="How">${items}</ol>`;
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
    ${scenarios()}
    <p class="lead-note">It changes through the day, so the next person can know before they drive out.</p>
    ${howSteps()}
    <p class="quiet">No name, no email, no phone number.</p>
    ${actions("Add a visit")}
  `;
}
