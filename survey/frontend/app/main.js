import { FORM_URL } from "./api.js";
import { destroyMap, mountMap } from "../map/map.js";
import {
  clearViewportVars,
  installGlobalLayoutRecovery,
  resetDocumentScroll,
} from "../map/viewport.js";
import { arrivalInRange, formatWall, nowInZone, shortZoneCode } from "./clock.js";
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
  document.documentElement.classList.toggle("on-map-step", onMap);
  document.body.classList.toggle("at-intro", atStart);
  document.body.classList.toggle("on-guide", onGuide);
  document.body.classList.toggle("on-map-step", onMap);
  if (!onMap) {
    clearViewportVars();
    resetDocumentScroll();
  }
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
  if (currentVisit.stepId === "hikeStart") syncTimeWheels();
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
  const label = button?.querySelector(".share-label");
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Karwan",
        text: "At the trailhead? Leave a one-minute Karwan note on parking, the pay box, and bathrooms—no account.",
        url,
      });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (label) label.textContent = "Link copied";
  } catch {
    if (label) label.textContent = "Copy failed";
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

function clampArrival(nextValue) {
  const zone = currentVisit.trailhead?.timezone;
  if (!zone) return nextValue;
  const now = nowInZone(zone);
  return nextValue > now ? now : nextValue;
}

function updateArrivalDate(dateStr) {
  if (!dateStr) return;
  const [, time = "08:00"] = (currentVisit.answers.hikeStart || "").split("T");
  currentVisit.answers.hikeStart = clampArrival(`${dateStr}T${time}`);
  currentVisit.arrivalWeekEnd = "";
}

function updateArrivalTime(hmStr) {
  if (!hmStr) return;
  const [date] = (currentVisit.answers.hikeStart || "").split("T");
  if (!date) return;
  currentVisit.answers.hikeStart = `${date}T${hmStr}`;
}

function refreshArrivalUi() {
  const trailhead = currentVisit.trailhead;
  if (!trailhead) return;
  const start = currentVisit.answers.hikeStart;
  const readout = document.querySelector(".arrival-readout");
  if (readout) readout.textContent = formatWall(start, trailhead.timezone);
  const [date] = (start || "").split("T");
  const clock = currentClock();
  for (const chip of document.querySelectorAll("#day-wheel .day-chip")) {
    const on = chip.dataset.pickDate === date;
    chip.classList.toggle("selected", on);
    chip.setAttribute("aria-pressed", String(on));
  }
  for (const chip of document.querySelectorAll("#hour-wheel .time-chip")) {
    chip.classList.toggle("selected", Number(chip.dataset.pickHour) === clock.hour12);
  }
  for (const chip of document.querySelectorAll("#minute-wheel .time-chip")) {
    chip.classList.toggle("selected", Number(chip.dataset.pickMinute) === clock.minute);
  }
  for (const btn of document.querySelectorAll("[data-pick-period]")) {
    const on = btn.dataset.pickPeriod === clock.period;
    btn.classList.toggle("selected", on);
    btn.setAttribute("aria-pressed", String(on));
  }
  const hint = document.querySelector(".time-step .hint");
  if (hint) {
    const inRange = arrivalInRange(start, trailhead.timezone);
    const code = shortZoneCode(start, trailhead.timezone);
    hint.textContent = start && !inRange
      ? `Choose a time from 2024 through now (${code}).`
      : `Use the local time at the trailhead (${code}) — no need to convert.`;
  }
  const nextBtn = document.getElementById("next");
  if (nextBtn) nextBtn.disabled = !nextStep(false);
}

function compose24h(h12, minute, period) {
  let h = Number(h12) % 12;
  if (period === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function currentClock() {
  const [, time = "08:00"] = (currentVisit.answers.hikeStart || "").split("T");
  const [hourText = "08", minuteText = "00"] = time.split(":");
  const hour24 = Number(hourText);
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: Number(minuteText),
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

function isVerticalWheel(scroller) {
  return scroller.classList.contains("is-vert");
}

function centerChip(scroller, chip) {
  if (!scroller || !chip) return;
  if (isVerticalWheel(scroller)) {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = chip.offsetTop - (scroller.clientHeight - chip.offsetHeight) / 2;
    scroller.scrollTop = Math.min(max, Math.max(0, target));
    return;
  }
  const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const chips = [...scroller.querySelectorAll(".day-chip")];
  const idx = chips.indexOf(chip);
  const firstIdx = Math.max(0, Math.min(Math.max(0, chips.length - 4), idx - 2));
  const target = chips[firstIdx] ? chips[firstIdx].offsetLeft : 0;
  scroller.scrollLeft = Math.min(max, Math.max(0, target));
}

function syncTimeWheels() {
  syncingWheels = true;
  const align = () => {
    for (const id of ["day-wheel", "hour-wheel", "minute-wheel"]) {
      const wheel = document.getElementById(id);
      centerChip(wheel, wheel?.querySelector(".selected"));
    }
  };
  align();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      align();
      setTimeout(() => {
        align();
        syncingWheels = false;
      }, 50);
    });
  });
}

function nearestChip(scroller) {
  const box = scroller.getBoundingClientRect();
  const vertical = isVerticalWheel(scroller);
  const mid = vertical ? box.top + box.height / 2 : box.left + box.width / 2;
  let best = null;
  let bestDist = Infinity;
  for (const chip of scroller.querySelectorAll(".time-chip, .day-chip")) {
    const edge = chip.getBoundingClientRect();
    const dist = vertical
      ? Math.abs(edge.top + edge.height / 2 - mid)
      : Math.abs(edge.left + edge.width / 2 - mid);
    if (dist < bestDist) {
      best = chip;
      bestDist = dist;
    }
  }
  return best;
}

function commitWheel(scroller) {
  if (syncingWheels || !scroller) return;
  if (scroller.id === "day-wheel") return;
  const chip = nearestChip(scroller);
  if (!chip) return;
  const clock = currentClock();
  if (scroller.id === "hour-wheel" && chip.dataset.pickHour) {
    const hour = Number(chip.dataset.pickHour);
    if (hour === clock.hour12) return;
    updateArrivalTime(compose24h(hour, clock.minute, clock.period));
    refreshArrivalUi();
    return;
  }
  if (scroller.id === "minute-wheel" && chip.dataset.pickMinute != null) {
    const minute = Number(chip.dataset.pickMinute);
    if (minute === clock.minute) return;
    updateArrivalTime(compose24h(clock.hour12, minute, clock.period));
    refreshArrivalUi();
  }
}

function lastDayOfMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function updateArrivalMonth(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return;
  const [date] = (currentVisit.answers.hikeStart || "").split("T");
  const day = Math.min(Number((date || "01").slice(8, 10) || 1), lastDayOfMonth(yearMonth));
  updateArrivalDate(`${yearMonth}-${String(day).padStart(2, "0")}`);
}

function onClick(event) {
  const shiftWeek = event.target.closest("[data-shift-week]");
  if (shiftWeek && !shiftWeek.disabled) {
    currentVisit.arrivalWeekEnd = shiftWeek.dataset.shiftWeek;
    draw(false);
    return;
  }
  const nudgeDays = event.target.closest("[data-nudge-days]");
  if (nudgeDays) {
    const dir = Number(nudgeDays.dataset.nudgeDays);
    const chips = [...document.querySelectorAll("#day-wheel .day-chip")];
    const index = chips.findIndex((chip) => chip.classList.contains("selected"));
    const nextChip = chips[Math.min(chips.length - 1, Math.max(0, index + dir))];
    if (nextChip?.dataset.pickDate) {
      updateArrivalDate(nextChip.dataset.pickDate);
      refreshArrivalUi();
      syncTimeWheels();
    }
    return;
  }
  const pickDate = event.target.closest("[data-pick-date]");
  if (pickDate) {
    updateArrivalDate(pickDate.dataset.pickDate);
    refreshArrivalUi();
    syncTimeWheels();
    return;
  }
  const pickHour = event.target.closest("[data-pick-hour]");
  if (pickHour) {
    const clock = currentClock();
    updateArrivalTime(compose24h(pickHour.dataset.pickHour, clock.minute, clock.period));
    refreshArrivalUi();
    syncTimeWheels();
    return;
  }
  const pickMinute = event.target.closest("[data-pick-minute]");
  if (pickMinute) {
    const clock = currentClock();
    updateArrivalTime(compose24h(clock.hour12, pickMinute.dataset.pickMinute, clock.period));
    refreshArrivalUi();
    syncTimeWheels();
    return;
  }
  const pickPeriod = event.target.closest("[data-pick-period]");
  if (pickPeriod) {
    const clock = currentClock();
    updateArrivalTime(compose24h(clock.hour12, clock.minute, pickPeriod.dataset.pickPeriod));
    refreshArrivalUi();
    return;
  }
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
  if (event.target.closest("#download")) downloadNote();
  if (event.target.closest("#share")) shareSurvey();
  if (event.target.id === "another") {
    resetAnswers();
    go("map");
  }
}

function onChange(event) {
  if (event.target.id === "hike-month") {
    updateArrivalMonth(event.target.value);
    draw(false);
  }
}

let syncingWheels = false;
screen.addEventListener("click", onClick);
screen.addEventListener("change", onChange);
screen.addEventListener("scroll", (event) => {
  const wheel = event.target.closest?.(".time-wheel");
  if (!wheel || syncingWheels) return;
  commitWheel(wheel);
}, true);
installGlobalLayoutRecovery();
draw(true);

fetch(FORM_URL)
  .then((response) => (response.ok ? response.json() : { open: true }))
  .then((data) => {
    currentVisit.closed = data.open === false;
    if (currentVisit.closed && currentVisit.stepId === "start") draw(false);
  })
  .catch(() => {});

const SCENE_NAMES = [
  "access-no", "access-skip", "access-yes",
  "bath-attention", "bath-closed", "bath-no", "bath-ok", "bath-skip", "bath-yes",
  "park-full", "park-lot", "park-skip", "park-street", "park-wait",
  "pay-bills", "pay-broken", "pay-card", "pay-envelope", "pay-free",
  "pay-nomachine", "pay-skip", "pay-tap",
  "stay-day", "stay-overnight",
];

function preloadScenes(ext) {
  for (const name of SCENE_NAMES) {
    const img = new Image();
    img.decoding = "async";
    img.src = `/survey/scenes/${name}.${ext}`;
  }
}

function warmScenes() {
  const run = () => {
    const avif = new Image();
    avif.onload = () => preloadScenes("avif");
    avif.onerror = () => {
      const webp = new Image();
      webp.onload = () => preloadScenes("webp");
      webp.onerror = () => preloadScenes("jpg");
      webp.src = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAA4BaJaQAA3AA/vXgwAA=";
    };
    avif.src = "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAIQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAKW1kYXQSAAoIGAAGiAhoNCAyExxHh4Xd0000wsAAAJA1jjx+iFA=";
  };
  if (window.requestIdleCallback) requestIdleCallback(run);
  else setTimeout(run, 700);
}

warmScenes();

