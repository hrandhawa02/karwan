import { arrivalInRange } from "./clock.js";
import { currentVisit } from "./current_visit.js";

export function stepOrder() {
  const answers = currentVisit.answers;
  const list = ["hikeStart", "stay", "carsWhere", "accessible", "payRequired"];
  if (answers.payRequired === "yes") list.push("payMachine");
  list.push("bathroom");
  if (answers.bathroomExists === "yes") list.push("bathroomHow");
  return list;
}

export function onLastStep() {
  const list = stepOrder();
  return list[list.length - 1] === currentVisit.stepId;
}

export function progressLabel() {
  const list = stepOrder();
  const index = list.indexOf(currentVisit.stepId);
  if (index < 0) return "";
  return `${index + 1} of ${list.length}`;
}

function zone() {
  return currentVisit.trailhead && currentVisit.trailhead.timezone;
}

const canLeave = {
  start: () => true,
  trailhead: () => Boolean(currentVisit.trailhead),
  hikeStart: () => arrivalInRange(currentVisit.answers.hikeStart, zone()),
  stay: () => Boolean(currentVisit.answers.stay),
  carsWhere: () => currentVisit.answers.carsWhere.length > 0,
  accessible: () => Boolean(currentVisit.answers.accessible),
  payRequired: () => Boolean(currentVisit.answers.payRequired),
  payMachine: () => currentVisit.answers.payMachine.length > 0,
  bathroom: () => Boolean(currentVisit.answers.bathroomExists),
  bathroomHow: () => Boolean(currentVisit.answers.bathroomCondition),
  check: () => !currentVisit.saving,
};

export function ready() {
  const check = canLeave[currentVisit.stepId];
  return check ? check() : false;
}

export function nextStep(force) {
  if (!force && !ready()) return null;
  if (currentVisit.stepId === "start") return "map";
  const list = stepOrder();
  const index = list.indexOf(currentVisit.stepId);
  if (index < 0 || index === list.length - 1) return null;
  return list[index + 1];
}

export function previousStep() {
  if (currentVisit.stepId === "map") return "start";
  if (currentVisit.stepId === "hikeStart") return "map";
  const list = stepOrder();
  const index = list.indexOf(currentVisit.stepId);
  if (index > 0) return list[index - 1];
  return null;
}
