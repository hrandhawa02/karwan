const FACTS = [
  ["parking", "6.9 million", "Parking Lots"],
  ["hike", "190,000", "Hike Routes"],
  ["bike", "83,000", "Bike Routes"],
  ["ski", "142,000", "Ski Routes"],
  ["climb", "81,000", "Climb Routes"],
  ["run", "1,300", "Run Routes"],
  ["camp", "138,000", "Camps"],
  ["shelter", "78,000", "Shelters"],
  ["peak", "700,000", "Peaks"],
  ["range", "12,000", "Shooting Ranges"],
  ["viewpoint", "92,000", "Viewpoints"],
];

const MARK_INK = "#a34e22";
const MARK_TINT = "#f4e4d4";

function circle(inner) {
  return `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="${MARK_TINT}"/>${inner}</svg>`;
}

const MARKS = {
  parking: circle(`<path d="M10.2 20.2V7.8h4.7c2.3 0 3.7 1.3 3.7 3.4 0 2.1-1.4 3.5-3.7 3.5h-2.4v5.5h-2.3zm2.3-7.4h2.1c1 0 1.6-.6 1.6-1.5s-.6-1.5-1.6-1.5h-2.1v3z" fill="${MARK_INK}"/>`),
  hike: circle(`<path d="M6.4 18.6c2.2-3.6 3.4-3.6 5.4 0s3.2 3.6 5.4 0 3-3.6 4.4 0" fill="none" stroke="${MARK_INK}" stroke-width="1.8" stroke-linecap="round"/>`),
  bike: circle(`<circle cx="9.2" cy="18.2" r="3.1" fill="none" stroke="${MARK_INK}" stroke-width="1.7"/><circle cx="19" cy="18.2" r="3.1" fill="none" stroke="${MARK_INK}" stroke-width="1.7"/><path d="M9.2 18.2 12.6 11.4h4.6l2.2 6.8M12.6 11.4 15.4 18.2" fill="none" stroke="${MARK_INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  ski: circle(`<path d="M10 7.5c2.4 5.2 2.2 7.4-.2 13M17.2 7.5c2.4 5.2 2.2 7.4-.2 13" fill="none" stroke="${MARK_INK}" stroke-width="1.8" stroke-linecap="round"/>`),
  climb: circle(`<path d="M7.5 20.5 14 6.8l2.3 5.2 4.7 8.5Z" fill="${MARK_INK}"/>`),
  run: circle(`<circle cx="15.2" cy="8.2" r="2" fill="${MARK_INK}"/><path d="M14.6 11.2 11.4 16.2l-3.2 1.6M14.2 12.4l3.4 1.4 1.8 4.4M10.8 16.2 14.2 21" fill="none" stroke="${MARK_INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  camp: circle(`<path d="M5.8 20.6 14 8.2l8.2 12.4H5.8z" fill="${MARK_INK}"/><path d="M14 8.6v12" stroke="${MARK_TINT}" stroke-width="1.3"/>`),
  shelter: circle(`<path d="M6.2 13.4 14 7.2l7.8 6.2V21H6.2v-7.6z" fill="${MARK_INK}"/>`),
  peak: circle(`<path d="M5.5 20.5 11 9.2l3.2 5.4L18.2 8 22.5 20.5Z" fill="${MARK_INK}"/>`),
  range: circle(`<circle cx="14" cy="14" r="5.2" fill="none" stroke="${MARK_INK}" stroke-width="1.5"/><circle cx="14" cy="14" r="2.5" fill="none" stroke="${MARK_INK}" stroke-width="1.5"/><circle cx="14" cy="14" r="0.9" fill="${MARK_INK}"/>`),
  viewpoint: circle(`<circle cx="14" cy="14" r="3.3" fill="none" stroke="${MARK_INK}" stroke-width="1.7"/><circle cx="14" cy="14" r="1.15" fill="${MARK_INK}"/><path d="M14 6.8v2.3M14 18.9v2.3M6.8 14h2.3M18.9 14h2.3" stroke="${MARK_INK}" stroke-width="1.6" stroke-linecap="round"/>`),
};

const symbol = document.getElementById("sport-symbol");
const number = document.getElementById("sport-number");
const name = document.getElementById("sport-name");
const fact = document.getElementById("sport-fact");
const copy = fact.querySelector(".sport-copy");
const dots = document.getElementById("sport-dots");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let index = 0;
let timer = 0;

FACTS.forEach(([, , label], item) => {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.setAttribute("aria-label", label);
  dot.addEventListener("click", () => {
    show(item);
    arm(7000);
  });
  dots.append(dot);
});

function show(next) {
  index = (next + FACTS.length) % FACTS.length;
  const [id, count, label] = FACTS[index];
  symbol.innerHTML = MARKS[id];
  number.textContent = count;
  name.textContent = label;
  fact.setAttribute("aria-label", `${count} ${label}. Show the next.`);
  [...dots.children].forEach((dot, item) => {
    const on = item === index;
    dot.classList.toggle("is-on", on);
    dot.setAttribute("aria-current", on ? "true" : "false");
  });
  copy.classList.remove("is-in");
  if (!reduceMotion) {
    void copy.offsetWidth;
    copy.classList.add("is-in");
  }
}

function arm(delay) {
  window.clearTimeout(timer);
  if (reduceMotion) return;
  timer = window.setTimeout(() => {
    show(index + 1);
    arm(4200);
  }, delay);
}

fact.addEventListener("click", () => {
  show(index + 1);
  arm(7000);
});

show(0);
arm(4200);
