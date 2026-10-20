export const labels = {
  stay: {
    day: "Day trip",
    overnight: "Overnight",
  },
  carsWhere: {
    spaces: "Spaces in the lot",
    roadside: "Cars on the street or shoulder",
    waiting: "Cars waiting or circling",
    left: "Someone left without a spot",
    didnt_look: "I didn’t look",
  },
  accessible: {
    yes: "Yes",
    no: "No",
    didnt_look: "I didn’t look",
  },
  payRequired: {
    no: "No payment required",
    yes: "Yes, parking costs money",
    didnt_look: "I didn’t look",
  },
  payMachine: {
    cards: "Cards, chip or swipe",
    tap: "Tap to pay, phone or card",
    bills: "Dollar bills",
    envelope: "Envelope box",
    broken: "The machine was broken that day",
    no_machine: "There was no machine",
    didnt_look: "I didn’t look",
  },
  bathroom: {
    yes: "Yes",
    no: "No",
    didnt_check: "I didn’t look",
  },
  condition: {
    ok: "OK",
    attention: "Needs attention",
    closed: "Closed",
  },
};

export function options(group) {
  return Object.entries(labels[group]);
}
