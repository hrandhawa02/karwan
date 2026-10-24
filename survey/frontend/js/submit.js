import { VISITS_URL } from "./api.js";
import { arrivalInRange, wallTimeToUtc } from "./clock.js";
import { currentVisit } from "./current_visit.js";

export function saveProblem() {
  const answers = currentVisit.answers;
  const zone = currentVisit.trailhead.timezone;
  if (!arrivalInRange(answers.hikeStart, zone)) {
    return "Choose a start time from 2024 through now.";
  }
  if (!wallTimeToUtc(answers.hikeStart, zone)) {
    return "This visit could not be saved. Check the time and try again.";
  }
  return "";
}

export function visitPayload() {
  const answers = currentVisit.answers;
  const zone = currentVisit.trailhead.timezone;
  const paid = answers.payRequired === "yes";
  const sawBathroom = answers.bathroomExists === "yes";
  return {
    place_id: currentVisit.trailhead.id,
    arrived_at: wallTimeToUtc(answers.hikeStart, zone),
    stay: answers.stay,
    cars_where: answers.carsWhere.slice().sort().join(","),
    accessible: answers.accessible,
    pay_required: answers.payRequired,
    pay_machine: paid ? answers.payMachine.slice().sort().join(",") : null,
    bathroom_exists: answers.bathroomExists,
    bathroom_condition: sawBathroom ? answers.bathroomCondition : null,
  };
}

const SAVE_FAILED = "This visit could not be saved. Check your connection and try again.";
const FORM_CLOSED = "Notes open in 2027.";

export async function postVisit(payload) {
  let response;
  try {
    response = await fetch(VISITS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(SAVE_FAILED);
  }
  if (response.ok) return;
  if (response.status === 403) throw new Error(FORM_CLOSED);
  throw new Error(SAVE_FAILED);
}
