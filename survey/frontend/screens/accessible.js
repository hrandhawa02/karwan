import { actions, sceneCards } from "../buttons.js";
import { labels } from "../labels.js";
import { currentVisit } from "../current_visit.js";

const CARDS = {
  yes: ["Marked spaces were there", "/survey/scenes/access-yes.jpg"],
  no: ["No marked spaces", "/survey/scenes/access-no.jpg"],
  didnt_look: ["Did not look for one", "/survey/scenes/access-skip.jpg"],
};

export function render() {
  const cards = Object.entries(labels.accessible).map(([value, label]) => {
    const [note, image] = CARDS[value];
    return { value, label, note, image };
  });
  return `
    <div class="park-step">
      <h1>Were there accessible parking spaces?</h1>
      <p class="hint">Marked spaces. Not how many, and not whether you used one.</p>
      ${sceneCards("accessible", cards, currentVisit.answers.accessible, false)}
      ${actions("Next >>")}
    </div>
  `;
}
