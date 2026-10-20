const FACTS = [
  ["parking", "6.9 million", "Parking Lots", "Leave the car here."],
  ["hike", "190,000", "Hike Routes", "Set out from the lot."],
  ["bike", "83,000", "Bike Routes", "Unload and ride."],
  ["ski", "142,000", "Snow Routes", "Ski or ride out from the lot."],
  ["climb", "81,000", "Climb Routes", "Gear up at the base."],
  ["foot", "190,000", "Walk Routes", "Walk out from the lot."],
  ["camp", "138,000", "Camps", "Stay at the site."],
  ["shelter", "78,000", "Shelters", "Step in from the weather."],
  ["peak", "700,000", "Peaks", "Plan your approach."],
  ["range", "12,000", "Shooting Ranges", "Park for the range."],
  ["viewpoint", "92,000", "Viewpoints", "Stop for the view."],
];

const MARK_INK = "#a34e22";
const MARK_TINT = "#f4e4d4";

function circle(inner) {
  return `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="${MARK_TINT}"/>${inner}</svg>`;
}

const MARKS = {
  parking: circle(`<path d="M10.2 20.2V7.8h4.7c2.3 0 3.7 1.3 3.7 3.4 0 2.1-1.4 3.5-3.7 3.5h-2.4v5.5h-2.3zm2.3-7.4h2.1c1 0 1.6-.6 1.6-1.5s-.6-1.5-1.6-1.5h-2.1v3z" fill="${MARK_INK}"/>`),
  hike: circle(`<g transform="translate(5.1 2.6) scale(0.585) rotate(-5 18 18)"><path fill="${MARK_INK}" d="M34.469 28.156c-.59-.885-2.458-2.365-4.5-2.656-2.112-.302-3.877.18-6.571-1.394-.086-.066-.171-.131-.273-.19-2.153-1.247-5.917-5.417-6-9.542-.047-2.336-3-2.625-5.375-2.333-2.375.292-10.083 2.083-9.792 3.25.248.991.224 5.316-.018 8.205-.366 2.27-.636 5.435-.636 7.44C1.303 31.599 2.333 32 2.333 32l14.198.5 17.688-.477s.933-.084.906-.711c-.042-.958-.156-2.406-.656-3.156z"/><path fill="${MARK_INK}" d="M1.334 31.216c.787.175 2.201.662 4.591.7 2.755.044 5.187-.525 8.308-.525 2.991 0 6.9.848 10.319.7 3.487-.152 7.35-.652 8.192-.799 1.667-.292 2.438-.479 2.438-.479s.365-.021.531.688c.167.708.304 2.083-.841 2.427-2.186.656-7.554 1.113-12.724 1.049-2.626-.032-5.549-.81-6.966-.976-1.417-.167-2.667-.287-3.062 0-.396.287.089.792-.946.933-2.58.35-8.614.044-9.928-.516-.672-.286-1.051-3.455.088-3.202z"/></g>`),
  bike: circle(`<circle cx="9.2" cy="18.2" r="3.1" fill="none" stroke="${MARK_INK}" stroke-width="1.7"/><circle cx="19" cy="18.2" r="3.1" fill="none" stroke="${MARK_INK}" stroke-width="1.7"/><path d="M9.2 18.2 12.6 11.4h4.6l2.2 6.8M12.6 11.4 15.4 18.2" fill="none" stroke="${MARK_INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  ski: circle(`<path d="M9.8 7.8v12.8" fill="none" stroke="${MARK_INK}" stroke-width="1.35" stroke-linecap="round"/><path d="M17.6 8.2v12.2" fill="none" stroke="${MARK_INK}" stroke-width="2.35" stroke-linecap="round"/>`),
  climb: circle(`<path d="M7.5 20.5 14 6.8l2.3 5.2 4.7 8.5Z" fill="${MARK_INK}"/>`),
  foot: circle(`<circle cx="14" cy="8.4" r="2.05" fill="${MARK_INK}"/><path d="M14 10.6v4.6M14 13l-3.2 5.2M14 13l4.2 4.8M14 11.6l-2.9 2.1M14 11.6l3.1 1.7" fill="none" stroke="${MARK_INK}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`),
  camp: circle(`<path d="M5.8 20.6 14 8.2l8.2 12.4H5.8z" fill="${MARK_INK}"/><path d="M14 8.6v12" stroke="${MARK_TINT}" stroke-width="1.3"/>`),
  shelter: circle(`<path d="M6.2 13.4 14 7.2l7.8 6.2V21H6.2v-7.6z" fill="${MARK_INK}"/>`),
  peak: circle(`<path d="M5.5 20.5 11 9.2l3.2 5.4L18.2 8 22.5 20.5Z" fill="${MARK_INK}"/>`),
  range: circle(`<circle cx="14" cy="14" r="5.2" fill="none" stroke="${MARK_INK}" stroke-width="1.5"/><circle cx="14" cy="14" r="2.5" fill="none" stroke="${MARK_INK}" stroke-width="1.5"/><circle cx="14" cy="14" r="0.9" fill="${MARK_INK}"/>`),
  viewpoint: circle(`<circle cx="14" cy="14" r="3.3" fill="none" stroke="${MARK_INK}" stroke-width="1.7"/><circle cx="14" cy="14" r="1.15" fill="${MARK_INK}"/><path d="M14 6.8v2.3M14 18.9v2.3M6.8 14h2.3M18.9 14h2.3" stroke="${MARK_INK}" stroke-width="1.6" stroke-linecap="round"/>`),
};

const rail = document.getElementById("sport-rail");
const dots = document.getElementById("sport-dots");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let index = 0;
let timer = 0;
let scrollTimer = 0;

FACTS.forEach(([id, count, label, line], item) => {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "sport-fact";
  card.innerHTML = `
    <span class="sport-symbol" aria-hidden="true">${MARKS[id]}</span>
    <span class="sport-copy">
      <span class="sport-number">${count}</span>
      <span class="sport-name">${label}</span>
      <span class="sport-note">${line}</span>
    </span>`;
  card.setAttribute("aria-label", `${count} ${label}. ${line}`);
  card.addEventListener("click", () => {
    show(item === index ? item + 1 : item);
    arm(7000);
  });
  rail.append(card);

  const dot = document.createElement("button");
  dot.type = "button";
  dot.setAttribute("aria-label", label);
  dot.addEventListener("click", () => {
    show(item);
    arm(7000);
  });
  dots.append(dot);
});

function paint() {
  [...rail.children].forEach((card, item) => {
    const on = item === index;
    card.classList.toggle("is-on", on);
    card.tabIndex = on ? 0 : -1;
    card.setAttribute("aria-current", on ? "true" : "false");
  });
  [...dots.children].forEach((dot, item) => {
    const on = item === index;
    dot.classList.toggle("is-on", on);
    dot.setAttribute("aria-current", on ? "true" : "false");
  });
}

function show(next, smooth = true) {
  index = (next + FACTS.length) % FACTS.length;
  paint();
  const card = rail.children[index];
  const left = card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2;
  rail.scrollTo({
    left: Math.max(0, left),
    behavior: smooth && !reduceMotion ? "smooth" : "auto",
  });
}

function nearest() {
  const mid = rail.scrollLeft + rail.clientWidth / 2;
  let best = 0;
  let bestDist = Infinity;
  [...rail.children].forEach((card, item) => {
    const dist = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  });
  return best;
}

function syncFromScroll() {
  const next = nearest();
  if (next === index) return;
  index = next;
  paint();
  arm(7000);
}

rail.addEventListener("scroll", () => {
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(syncFromScroll, 140);
}, { passive: true });

function arm(delay) {
  window.clearTimeout(timer);
  if (reduceMotion) return;
  timer = window.setTimeout(() => {
    show(index + 1);
    arm(4200);
  }, delay);
}

show(0, false);
arm(4200);
