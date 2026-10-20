import { FORM_URL } from "./api.js";
import { destroyMap, mountMap } from "./screens/map.js";
import { nextStep, previousStep, progressLabel } from "./steps.js";
import { postVisit, saveProblem, visitPayload } from "./submit.js";
import * as screens from "./screens/index.js";
import { pdfBytes } from "./pdf.js";
import { noteText } from "./screens/check.js";
import { loadingMessage } from "./screens/loading.js";
import { resetAnswers, setAnswer, toggleBathroom, toggleCars, togglePayLot, currentVisit } from "./current_visit.js";

const screen = document.getElementById("screen");
const trailheadLine = document.getElementById("trailhead-line");
const stepLine = document.getElementById("step-line");

function screenHtml() {
  if (currentVisit.stepId !== "start" && currentVisit.stepId !== "guide") {
    const waiting = loadingMessage();
    if (waiting) return waiting;
  }
  return screens[currentVisit.stepId]();
}

function draw(moveFocus) {
  const atStart = currentVisit.stepId === "start";
  const onGuide = currentVisit.stepId === "guide";
  const onMap = currentVisit.stepId === "map";
  document.body.classList.toggle("at-start", atStart);
  document.body.classList.toggle("on-guide", onGuide);
  document.body.classList.toggle("on-map-step", onMap);
  if (!onMap) document.body.classList.remove("map-naming");
  trailheadLine.textContent = currentVisit.trailhead && !atStart && !onMap
    ? currentVisit.trailhead.name
    : "";
  const counting = !atStart && !onMap && currentVisit.stepId !== "thanks";
  stepLine.textContent = counting ? progressLabel() : "";
  if (onMap) {
    if (!screen.querySelector("#visit-map")) {
      screen.innerHTML = screens.map();
      mountMap(screen, go);
    }
    return;
  }
  if (screen.querySelector("#visit-map")) destroyMap();
  screen.innerHTML = screenHtml();
  if (!moveFocus || atStart) return;
  const heading = screen.querySelector("h1");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function go(next) {
  currentVisit.stepId = next;
  draw(true);
}

function forward(force) {
  const next = nextStep(force);
  if (!next) return;
  go(next);
}

function back() {
  const previous = previousStep();
  if (previous) go(previous);
}

async function saveVisit() {
  if (currentVisit.saving) return;
  const problem = saveProblem();
  if (problem) {
    currentVisit.answers.saveError = problem;
    draw(false);
    return;
  }
  currentVisit.saving = true;
  currentVisit.answers.saveError = "";
  draw(false);
  try {
    await postVisit(visitPayload());
    currentVisit.savedNote = noteText();
    currentVisit.saving = false;
    resetAnswers();
    go("thanks");
  } catch (error) {
    currentVisit.saving = false;
    currentVisit.answers.saveError = error.message
      || "This visit could not be saved. Check your connection and try again.";
    draw(false);
  }
}

async function shareSurvey() {
  const url = `${location.origin}/survey/`;
  const button = document.getElementById("share");
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Karwan",
        text: "One-minute trailhead parking note.",
        url,
      });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (button) button.textContent = "Link copied";
  } catch {
    if (button) button.textContent = "Copy the page address";
  }
}

function downloadNote() {
  const file = new Blob([pdfBytes(currentVisit.savedNote)], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = "karwan-visit.pdf";
  link.click();
  URL.revokeObjectURL(link.href);
}

function onClick(event) {
  const choice = event.target.closest("[data-value]");
  if (choice) {
    if (choice.dataset.field === "carsWhere") toggleCars(choice.dataset.value);
    else if (choice.dataset.field === "payLot") togglePayLot(choice.dataset.value);
    else if (choice.dataset.field === "bathroomLot") toggleBathroom(choice.dataset.value);
    else setAnswer(choice.dataset.field, choice.dataset.value);
    draw(false);
    return;
  }
  if (event.target.id === "next") forward();
  if (event.target.id === "back") back();
  if (event.target.id === "save") saveVisit();
  if (event.target.id === "download") downloadNote();
  if (event.target.id === "share") shareSurvey();
  if (event.target.id === "another") {
    resetAnswers();
    go("map");
  }
}

function onChange(event) {
  const answers = currentVisit.answers;
  if (event.target.id === "hike-start") {
    answers.hikeStart = event.target.value;
    draw(false);
  }
}

screen.addEventListener("click", onClick);
screen.addEventListener("change", onChange);
draw(true);

fetch(FORM_URL)
  .then((response) => (response.ok ? response.json() : { open: true }))
  .then((data) => {
    currentVisit.closed = data.open === false;
    if (currentVisit.closed && currentVisit.stepId === "start") draw(false);
  })
  .catch(() => {});

