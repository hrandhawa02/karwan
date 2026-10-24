import { actions, esc } from "../buttons.js";
import { formatWall } from "../clock.js";
import { currentVisit } from "../current_visit.js";
import { labels } from "../labels.js";

function bathroomSummary() {
  const answers = currentVisit.answers;
  if (answers.bathroomExists === "no") return "No";
  if (answers.bathroomExists === "didnt_check") return "I didn’t look";
  return String(answers.bathroomCondition || "")
    .split(",")
    .filter(Boolean)
    .map((value) => labels.condition[value])
    .join(", ");
}

function paySummary() {
  const answers = currentVisit.answers;
  if (answers.payRequired === "no") return "No payment required";
  if (answers.payRequired === "didnt_look") return "I didn’t look";
  return answers.payMachine.map((value) => labels.payMachine[value]).join(", ");
}

function staySummary() {
  return labels.stay[currentVisit.answers.stay];
}

function row(label, value) {
  return `
    <div>
      <dt>${esc(label)}</dt>
      <dd>${esc(value)}</dd>
    </div>
  `;
}

export function noteText() {
  const answers = currentVisit.answers;
  const zone = currentVisit.trailhead.timezone || currentVisit.trailhead.zone_label;
  const cars = answers.carsWhere.map((value) => labels.carsWhere[value]).join(", ");
  return [
    "Karwan",
    currentVisit.trailhead.name,
    "",
    `Got there: ${formatWall(answers.hikeStart, zone)}`,
    `Day or overnight: ${staySummary()}`,
    `Cars: ${cars}`,
    `Accessible parking: ${labels.accessible[answers.accessible]}`,
    `Parking payment: ${paySummary()}`,
    `Bathrooms: ${bathroomSummary()}`,
    "",
    "Thank you for the time you took.",
    "A note like this is how Karwan gets better.",
  ].join("\n");
}

function rows() {
  const answers = currentVisit.answers;
  const zone = currentVisit.trailhead.timezone || currentVisit.trailhead.zone_label;
  const cars = answers.carsWhere.map((value) => labels.carsWhere[value]).join(", ");
  return [
    row("Got there", formatWall(answers.hikeStart, zone)),
    row("Day or overnight", staySummary()),
    row("Cars", cars),
    row("Accessible parking", labels.accessible[answers.accessible]),
    row("Parking payment", paySummary()),
    row("Bathrooms", bathroomSummary()),
  ].join("");
}

export function render() {
  return `
    <div class="park-step">
      <h1>Check this visit</h1>
      <dl class="check">${rows()}</dl>
      ${actions("Submit this note", "This sends the lot note.")}
    </div>
  `;
}
