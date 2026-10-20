export function blankAnswers() {
  return {
    hikeStart: "",
    stay: null,
    carsWhere: [],
    accessible: null,
    payRequired: null,
    payMachine: [],
    bathroomExists: null,
    bathroomCondition: null,
    saveError: "",
  };
}

export const currentVisit = {
  trailhead: null,
  trailheadError: false,
  closed: false,
  stepId: "start",
  saving: false,
  savedNote: "",
  answers: blankAnswers(),
};

export function toggleCars(value) {
  const answers = currentVisit.answers;
  const picked = answers.carsWhere.filter((item) => item !== "didnt_look");
  if (value === "didnt_look") {
    answers.carsWhere = answers.carsWhere.includes("didnt_look") ? [] : ["didnt_look"];
  } else if (picked.includes(value)) {
    answers.carsWhere = picked.filter((item) => item !== value);
  } else {
    answers.carsWhere = picked.concat(value);
  }
  answers.saveError = "";
}

export function togglePayLot(value) {
  const answers = currentVisit.answers;
  if (value === "no" || value === "didnt_look") {
    answers.payRequired = answers.payRequired === value ? null : value;
    answers.payMachine = [];
    answers.saveError = "";
    return;
  }
  answers.payRequired = "yes";
  togglePay(value);
  if (answers.payMachine.length === 0) answers.payRequired = null;
}

const BATH_ALONE = new Set(["no", "didnt_check"]);
const BATH_COND = ["ok", "attention", "closed"];

export function bathSelection() {
  const answers = currentVisit.answers;
  if (answers.bathroomExists === "yes") {
    return String(answers.bathroomCondition || "").split(",").filter(Boolean);
  }
  return answers.bathroomExists ? [answers.bathroomExists] : [];
}

export function toggleBathroom(value) {
  const answers = currentVisit.answers;
  if (BATH_ALONE.has(value)) {
    answers.bathroomExists = answers.bathroomExists === value ? null : value;
    answers.bathroomCondition = null;
  } else {
    let picked = bathSelection().filter((item) => BATH_COND.includes(item));
    picked = picked.includes(value)
      ? picked.filter((item) => item !== value)
      : picked.concat(value);
    if (picked.length === 0) {
      answers.bathroomExists = null;
      answers.bathroomCondition = null;
    } else {
      answers.bathroomExists = "yes";
      answers.bathroomCondition = picked.slice().sort().join(",");
    }
  }
  answers.saveError = "";
}

export function togglePay(value) {
  const answers = currentVisit.answers;
  const machine = new Set(["cards", "tap", "bills", "broken"]);
  let picked = answers.payMachine.filter((item) => item !== "didnt_look");
  if (value === "didnt_look") {
    answers.payMachine = answers.payMachine.includes("didnt_look") ? [] : ["didnt_look"];
  } else if (picked.includes(value)) {
    answers.payMachine = picked.filter((item) => item !== value);
  } else if (value === "no_machine") {
    picked = picked.filter((item) => item === "envelope");
    answers.payMachine = picked.concat(value);
  } else if (machine.has(value)) {
    picked = picked.filter((item) => item !== "no_machine");
    answers.payMachine = picked.concat(value);
  } else {
    answers.payMachine = picked.concat(value);
  }
  answers.saveError = "";
}

export function setAnswer(field, value) {
  const answers = currentVisit.answers;
  answers[field] = value;
  if (field === "payRequired" && value !== "yes") {
    answers.payMachine = [];
  }
  if (field === "bathroomExists" && value !== "yes") {
    answers.bathroomCondition = null;
  }
  answers.saveError = "";
}

export function resetAnswers() {
  currentVisit.answers = blankAnswers();
}
