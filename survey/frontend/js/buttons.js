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

export function scenePicture(image, lazy) {
  const base = String(image).replace(/\.(avif|webp|jpe?g)$/i, "");
  const loading = lazy ? "lazy" : "eager";
  const priority = lazy ? "" : ` fetchpriority="high"`;
  return `<picture>`
    + `<source srcset="${esc(base)}.avif" type="image/avif">`
    + `<source srcset="${esc(base)}.webp" type="image/webp">`
    + `<img src="${esc(base)}.jpg" alt="" loading="${loading}" decoding="async"${priority}>`
    + `</picture>`;
}

export function sceneCards(field, cards, selected, multi) {
  const layout = cards.length <= 3 ? "is-wide" : "is-grid";
  const buttons = cards.map(({ value, label, note, image }, index) => {
    const on = multi ? selected.includes(value) : selected === value;
    const role = multi ? "checkbox" : "radio";
    const lazy = layout === "is-grid" && index >= 2;
    return `<button type="button" class="park-card${on ? " selected" : ""}" data-field="${field}" data-value="${esc(value)}" role="${role}" aria-checked="${on}">
      <span class="park-scene">
        ${scenePicture(image, lazy)}
        <span class="park-tick" aria-hidden="true"></span>
      </span>
      <span class="park-copy">
        <span class="park-title">${esc(label)}</span>
        <span class="park-note">${esc(note)}</span>
      </span>
    </button>`;
  });
  return `<div class="park-cards ${layout}">${buttons.join("")}</div>`;
}

export function checks(field, options, selected) {
  const buttons = options.map(([value, label]) => (
    choiceButton(field, value, label, selected, true)
  ));
  return `<div class="choices">${buttons.join("")}</div>`;
}

export function actions(primary, note) {
  const showBack = currentVisit.stepId !== "start" && currentVisit.stepId !== "thanks";
  const back = showBack
    ? `<button type="button" class="back" id="back">Back</button>`
    : "";
  const last = onLastStep();
  const label = last ? (currentVisit.saving ? "Sending" : "Submit this note") : primary;
  const id = last ? "save" : "next";
  const enabled = ready() && !currentVisit.saving ? "" : "disabled";
  const error = currentVisit.answers.saveError
    ? `<p class="error" role="alert">${esc(currentVisit.answers.saveError)}</p>`
    : "";
  const line = note ? `<p class="hint send-note">${esc(note)}</p>` : "";
  return `<div class="actions">
    ${error}
    ${line}
    ${back}
    <button type="button" class="next" id="${id}" ${enabled}>${label}</button>
  </div>`;
}
