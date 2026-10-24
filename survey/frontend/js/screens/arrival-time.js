import { actions, esc } from "../buttons.js";
import { arrivalInRange, formatWall, nowInZone, shortZoneCode } from "../clock.js";
import { currentVisit } from "../current_visit.js";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

function parseYmd(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dayWheel(selectedDate, today) {
  const month = selectedDate.slice(0, 7);
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const days = [];
  for (let day = 1; day <= last; day += 1) {
    const ymd = `${month}-${String(day).padStart(2, "0")}`;
    if (ymd > today) break;
    const stamp = parseYmd(ymd);
    days.push(
      `<button type="button" class="day-chip${ymd === selectedDate ? " selected" : ""}" data-pick-date="${esc(ymd)}" aria-pressed="${ymd === selectedDate}">`
      + `<span class="day-dow">${esc(WEEKDAY.format(stamp))}</span>`
      + `<span class="day-num">${stamp.getUTCDate()}</span>`
      + `</button>`,
    );
  }
  return days.join("");
}

function parseHm(timeStr) {
  const [hourText = "08", minuteText = "00"] = (timeStr || "08:00").split(":");
  const hour24 = Number(hourText);
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: Number(minuteText),
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

function hourWheel(hour12) {
  const chips = [];
  for (let hour = 1; hour <= 12; hour += 1) {
    chips.push(
      `<button type="button" class="time-chip${hour === hour12 ? " selected" : ""}" data-pick-hour="${hour}">${String(hour).padStart(2, "0")}</button>`,
    );
  }
  return chips.join("");
}

function minuteWheel(minute) {
  const chips = [];
  for (let value = 0; value < 60; value += 1) {
    chips.push(
      `<button type="button" class="time-chip${value === minute ? " selected" : ""}" data-pick-minute="${value}">${String(value).padStart(2, "0")}</button>`,
    );
  }
  return chips.join("");
}

export function render() {
  const trailhead = currentVisit.trailhead;
  const tz = trailhead.timezone;
  const now = nowInZone(tz);
  if (!currentVisit.answers.hikeStart) {
    currentVisit.answers.hikeStart = now;
  }
  const start = currentVisit.answers.hikeStart;
  const inRange = arrivalInRange(start, tz);
  const [date, time] = start.split("T");
  const today = now.slice(0, 10);
  const { hour12, minute, period } = parseHm(time);
  const code = shortZoneCode(start, tz);
  let hint = `Use the local time at the trailhead (${code}) — no need to convert.`;
  if (start && !inRange) {
    hint = `Choose a time from 2024 through now (${code}).`;
  }
  return `
    <div class="park-step time-step">
      <h1 id="q">What time did you get there?</h1>
      <p class="hint">${esc(hint)}</p>
      <div class="arrival-card" role="group" aria-labelledby="q">
        <p class="arrival-readout" aria-live="polite">${esc(formatWall(start, tz))}</p>
        <div class="picker-section">
          <label class="cal-month">
            <span>${esc(MONTH_YEAR.format(parseYmd(date)))}</span>
            <input id="hike-month" type="month" aria-label="Month and year"
              min="2024-01" max="${esc(today.slice(0, 7))}" value="${esc(date.slice(0, 7))}">
          </label>
          <div class="date-strip">
            <button type="button" class="day-nav" data-nudge-days="-1" aria-label="Earlier days">&#8249;</button>
            <div class="time-wheel is-days" id="day-wheel" aria-label="Date">${dayWheel(date, today)}</div>
            <button type="button" class="day-nav" data-nudge-days="1" aria-label="Later days">&#8250;</button>
          </div>
        </div>
        <div class="picker-section is-time">
          <div class="clock-tray">
            <div class="tumbler-pair">
              <div class="wheel-block">
                <span class="wheel-label">Hour</span>
                <div class="time-wheel is-vert" id="hour-wheel" aria-label="Hour">${hourWheel(hour12)}</div>
              </div>
              <span class="time-colon" aria-hidden="true">:</span>
              <div class="wheel-block">
                <span class="wheel-label">Minute</span>
                <div class="time-wheel is-vert" id="minute-wheel" aria-label="Minute">${minuteWheel(minute)}</div>
              </div>
            </div>
            <div class="ampm-toggle" role="group" aria-label="AM or PM">
              <button type="button" class="ampm-btn${period === "AM" ? " selected" : ""}" data-pick-period="AM" aria-pressed="${period === "AM"}">AM</button>
              <button type="button" class="ampm-btn${period === "PM" ? " selected" : ""}" data-pick-period="PM" aria-pressed="${period === "PM"}">PM</button>
            </div>
          </div>
        </div>
      </div>
      ${actions("Set date & time")}
    </div>
  `;
}
