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
    [
      "Live Parking Status", 
      "Check if parking spaces are wide open, filling fast, or fully packed.", 
      "/survey/scenes/park-full.jpg"
    ],
    [
      "Pay Machine Status", 
      "Note if local pay boxes work smoothly or if machines are down.", 
      "/survey/scenes/pay-card.jpg"
    ],
    [
      "Bathroom Availability", 
      "Log if regional trailhead restrooms are open or locked up.", 
      "/survey/scenes/bath-closed.jpg"
    ],
  ];
  const items = lines.map(([title, subtitle, image]) => `
    <li>
      ${scenePicture(image, false)}
      <div class="metric-text">
        <strong>${title}</strong>
        <em>${subtitle}</em>
      </div>
    </li>
  `).join("");
  return `<ul class="scenarios">${items}</ul>`;
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
    <div class="hero-section">
      <h1 class="hero-title">At the trailhead?</h1>
      <p class="hero-desc">Leave a short note for the next hiker on parking, pay machines, and bathrooms.</p>
    </div>
    ${scenarios()}
    <div class="spacer"></div>
    <div class="trust-tag">
      <span class="trust-text">No account, no tracking, or registration required.</span>
    </div>
    ${actions("Check in trailhead status")}
  `;
}
