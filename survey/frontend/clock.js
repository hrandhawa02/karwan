function partsOf(localValue, pattern) {
  const match = pattern.exec(localValue);
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function nowInZone(timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

function wallParts(utc, timeZone) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utc));
  return Object.fromEntries(
    formatted.map((part) => [part.type, part.value]),
  );
}

export function wallTimeToUtc(localValue, timeZone) {
  const numbers = partsOf(
    localValue,
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!numbers) return null;
  const [year, month, day, hour, minute] = numbers;
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  for (let i = 0; i < 4; i += 1) {
    const parts = wallParts(utc, timeZone);
    const wallHour = parts.hour === "24" ? 0 : Number(parts.hour);
    const asWall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      wallHour,
      Number(parts.minute),
    );
    const diff = desired - asWall;
    utc += diff;
    if (diff === 0) break;
  }
  return new Date(utc).toISOString();
}

export function formatWall(localValue, zoneLabel) {
  const numbers = partsOf(
    localValue,
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!numbers) return "";
  const [year, month, day, hour, minute] = numbers;
  const stamp = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(stamp);
  return `${clock} ${zoneLabel}`;
}

export const earliestArrival = "2024-01-01T00:00";

export function arrivalInRange(localValue, timeZone) {
  if (!timeZone) return false;
  const shape = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  if (!shape.test(localValue)) return false;
  if (localValue < earliestArrival) return false;
  return localValue <= nowInZone(timeZone);
}
