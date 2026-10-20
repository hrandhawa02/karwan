import { actions, sceneCards } from "../buttons.js";
import { labels } from "../labels.js";
import { currentVisit } from "../current_visit.js";

const CARDS = {
  spaces: ["You parked in the lot, or open spots were there when you arrived", "/survey/scenes/park-lot.jpg"],
  roadside: ["You or others parked on the road or shoulder", "/survey/scenes/park-street.jpg"],
  waiting: ["For a lot spot — you or other drivers", "/survey/scenes/park-wait.jpg"],
  left: ["Your group or others drove away without parking", "/survey/scenes/park-full.jpg"],
  didnt_look: ["You didn’t pay attention to parking here", "/survey/scenes/park-skip.jpg"],
};

export function render() {
  const cards = Object.entries(labels.carsWhere).map(([value, label]) => {
    const [note, image] = CARDS[value];
    return { value, label, note, image };
  });
  return `
    <div class="park-step">
      <h1>What did parking look like when you pulled in?</h1>
      <p class="hint">Check all that apply — you or what you saw. I didn’t look is only by itself.</p>
      ${sceneCards("carsWhere", cards, currentVisit.answers.carsWhere, true)}
      ${actions("Next >>")}
    </div>
  `;
}
