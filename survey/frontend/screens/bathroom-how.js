import { actions, sceneCards } from "../buttons.js";
import { labels } from "../labels.js";
import { currentVisit } from "../current_visit.js";

const CARDS = {
  ok: ["Usable", "/survey/scenes/bath-ok.jpg"],
  attention: ["Worn or untidy", "/survey/scenes/bath-attention.jpg"],
  closed: ["The door was shut", "/survey/scenes/bath-closed.jpg"],
};

export function render() {
  const cards = Object.entries(labels.condition).map(([value, label]) => {
    const [note, image] = CARDS[value];
    return { value, label, note, image };
  });
  return `
    <div class="park-step">
      <h1>How were the bathrooms?</h1>
      ${sceneCards("bathroomCondition", cards, currentVisit.answers.bathroomCondition, false)}
      ${actions("Next >>")}
    </div>
  `;
}
