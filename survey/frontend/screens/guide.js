import { actions } from "../buttons.js";

export function render() {
  return `
    <h1>Two steps</h1>
    <p class="hint">About a minute.</p>
    <ol class="guide-steps">
      <li>
        <span class="guide-num" aria-hidden="true">1</span>
        <div>
          <h2>Pick the lot</h2>
          <p>Pick the parking lot for the sport you were out for. The map includes about <strong class="guide-count">6.9 million</strong> lots and named places for hike, snow, climb, beach, lift, and more. Drop a pin if the lot is not listed.</p>
        </div>
      </li>
      <li>
        <span class="guide-num" aria-hidden="true">2</span>
        <div>
          <h2>Tell us what you saw</h2>
          <ul>
            <li>Where the cars were, and if accessible spaces were there</li>
            <li>Whether a pass or payment was needed, and if a pay machine worked</li>
            <li>Whether there was a bathroom, and what shape it was in</li>
          </ul>
        </div>
      </li>
    </ol>
    ${actions("Continue")}
    <p class="legal">
      <a href="/privacy">Privacy</a>
      <span aria-hidden="true"> · </span>
      <a href="/terms">Terms</a>
      <span aria-hidden="true"> · </span>
      © 2026 Karwan
    </p>
  `;
}
