import { actions, sceneCards } from "../buttons.js";
import { bathSelection } from "../current_visit.js";

const CARDS = [
  ["no", "No", "No bathroom at the lot", "/survey/scenes/bath-no.jpg"],
  ["ok", "OK", "Usable", "/survey/scenes/bath-ok.jpg"],
  ["attention", "Needs attention", "Worn or untidy", "/survey/scenes/bath-attention.jpg"],
  ["closed", "Closed", "The door was shut", "/survey/scenes/bath-closed.jpg"],
  ["didnt_check", "I didn’t look", "Did not look", "/survey/scenes/bath-skip.jpg"],
];

export function render() {
  const cards = CARDS.map(([value, label, note, image]) => ({ value, label, note, image }));
  return `
    <div class="park-step">
      <h1>Were there bathrooms?</h1>
      <p class="hint">Check every one that fits. No bathroom and I didn’t look each stand on their own.</p>
      ${sceneCards("bathroomLot", cards, bathSelection(), true)}
      ${actions("Next >>")}
    </div>
  `;
}
