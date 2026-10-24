import { actions, sceneCards } from "../buttons.js";
import { labels } from "../labels.js";
import { currentVisit } from "../current_visit.js";

const CARDS = {
  day: ["Back before dark", "/survey/scenes/stay-day.jpg"],
  overnight: ["Car stayed past that day", "/survey/scenes/stay-overnight.jpg"],
};

export function render() {
  const cards = Object.entries(labels.stay).map(([value, label]) => {
    const [note, image] = CARDS[value];
    return { value, label, note, image };
  });
  return `
    <div class="park-step">
      <h1>Day trip or overnight?</h1>
      <p class="hint">Pick the one that fits. Overnight means a car was still at the lot after that calendar day.</p>
      ${sceneCards("stay", cards, currentVisit.answers.stay, false)}
      ${actions("Set the stay")}
    </div>
  `;
}
