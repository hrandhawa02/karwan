import { actions, sceneCards } from "../buttons.js";
import { currentVisit } from "../current_visit.js";

const CARDS = [
  ["no", "No payment required", "Parking was free", "/survey/scenes/pay-free.jpg"],
  ["cards", "Cards, chip or swipe", "A card slot was there", "/survey/scenes/pay-card.jpg"],
  ["tap", "Tap to pay", "Phone or card", "/survey/scenes/pay-tap.jpg"],
  ["bills", "Dollar bills", "Cash at the machine", "/survey/scenes/pay-bills.jpg"],
  ["envelope", "Envelope box", "Drop the fee in", "/survey/scenes/pay-envelope.jpg"],
  ["broken", "The machine was broken", "It was out that day", "/survey/scenes/pay-broken.jpg"],
  ["no_machine", "There was no machine", "Nothing there to pay at", "/survey/scenes/pay-nomachine.jpg"],
  ["didnt_look", "I didn’t look", "Did not check", "/survey/scenes/pay-skip.jpg"],
];

function selected() {
  const answers = currentVisit.answers;
  if (answers.payRequired === "yes") return answers.payMachine;
  return answers.payRequired ? [answers.payRequired] : [];
}

export function render() {
  const cards = CARDS.map(([value, label, note, image]) => ({ value, label, note, image }));
  return `
    <div class="park-step">
      <h1>How could someone pay to park?</h1>
      <p class="hint">Check every way that fits. No payment and I didn’t look each stand on their own.</p>
      ${currentVisit.filledFromMap?.pay ? `<p class="hint">Filled from the map listing. Change it if this lot was different.</p>` : ""}
      ${sceneCards("payLot", cards, selected(), true)}
      ${actions("Note payment")}
    </div>
  `;
}
