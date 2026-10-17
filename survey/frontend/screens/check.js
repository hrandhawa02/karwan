import { esc } from "../buttons.js";
import { formatWall } from "../clock.js";
import { currentVisit } from "../current_visit.js";
import { labels } from "../labels.js";

function bathroomSummary() {
  const answers = currentVisit.answers;
  if (answers.bathroomExists === "no") return "No";
  if (answers.bathroomExists === "didnt_check") return "I didn’t look";
  const condition = labels.condition[answers.bathroomCondition];
  if (condition === "OK") return "Yes, OK";
  return `Yes, ${condition.toLowerCase()}`;
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
  const zone = currentVisit.trailhead.zone_label;
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
  const zone = currentVisit.trailhead.zone_label;
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
  const error = currentVisit.answers.saveError
    ? `<p class="error" role="alert">${esc(currentVisit.answers.saveError)}</p>`
    : "";
  const label = currentVisit.saving ? "Saving" : "Save";
  const disabled = currentVisit.saving ? "disabled" : "";
  return `
    <h1>Check this visit</h1>
    <dl class="check">${rows()}</dl>
    ${error}
    <div class="actions">
      <button type="button" class="back" id="back">&lt;&lt; Back</button>
      <button type="button" class="next" id="save" ${disabled}>${label}</button>
    </div>
  `;
}
