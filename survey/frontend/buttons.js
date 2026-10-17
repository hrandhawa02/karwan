import { onLastStep, ready } from "./steps.js";
import { currentVisit } from "./current_visit.js";

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function choiceButton(field, value, label, selected, box) {
  const on = Array.isArray(selected) ? selected.includes(value) : selected === value;
  const selectedClass = on ? " selected" : "";
  const boxClass = box ? " choice-box" : "";
  const mark = box ? `<span class="tick" aria-hidden="true"></span>` : "";
  const state = box
    ? ` role="checkbox" aria-checked="${on}"`
    : ` aria-pressed="${on}"`;
  return `<button type="button" class="choice${boxClass}${selectedClass}"`
    + ` data-field="${field}" data-value="${esc(value)}"`
    + `${state}>${mark}<span>${label}</span></button>`;
}

export function choices(field, options, selected) {
  const buttons = options.map(([value, label]) => (
    choiceButton(field, value, label, selected, false)
  ));
  return `<div class="choices">${buttons.join("")}</div>`;
}

export function checks(field, options, selected) {
  const buttons = options.map(([value, label]) => (
    choiceButton(field, value, label, selected, true)
  ));
  return `<div class="choices">${buttons.join("")}</div>`;
}

export function actions(primary) {
  const showBack = currentVisit.stepId !== "start" && currentVisit.stepId !== "thanks";
  const back = showBack
    ? `<button type="button" class="back" id="back">&lt;&lt; Back</button>`
    : "";
  const last = onLastStep();
  const label = last ? (currentVisit.saving ? "Submitting" : "Submit") : primary;
  const id = last ? "save" : "next";
  const enabled = ready() && !currentVisit.saving ? "" : "disabled";
  const error = currentVisit.answers.saveError
    ? `<p class="error" role="alert">${esc(currentVisit.answers.saveError)}</p>`
    : "";
  return `<div class="actions">
    ${error}
    ${back}
    <button type="button" class="next" id="${id}" ${enabled}>${label}</button>
  </div>`;
}
