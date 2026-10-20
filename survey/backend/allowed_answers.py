from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

CARS_WHERE = {"spaces", "roadside", "waiting", "left", "didnt_look"}
ACCESSIBLE = {"yes", "no", "didnt_look"}
PAY_REQUIRED = {"no", "yes", "didnt_look"}
PAY_MACHINE = {"cards", "tap", "bills", "envelope", "broken", "no_machine", "didnt_look"}
MACHINE_WAYS = {"cards", "tap", "bills", "broken"}
BATH_EXISTS = {"yes", "no", "didnt_check"}
BATH_COND = {"ok", "attention", "closed"}


def bad(message: str) -> None:
    raise HTTPException(status_code=400, detail=message)


def blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


EARLIEST_ARRIVAL = date(2024, 1, 1)


def parse_arrived(value: str) -> datetime:
    try:
        arrived = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        bad("Arrival time is not a valid time.")
    if arrived.tzinfo is None:
        bad("Arrival time needs a time zone.")
    return arrived.astimezone(timezone.utc)


def check_arrival_window(arrived: datetime, timezone_name: str) -> None:
    local_day = arrived.astimezone(ZoneInfo(timezone_name)).date()
    if local_day < EARLIEST_ARRIVAL:
        bad("Arrival has to be in 2024 or later.")
    latest = datetime.now(timezone.utc) + timedelta(minutes=5)
    if arrived > latest:
        bad("Arrival has to be a visit that already happened.")


def check_hike_end(started: datetime, ended: datetime, timezone_name: str) -> None:
    check_arrival_window(ended, timezone_name)
    if ended <= started:
        bad("The hike end has to be after the start.")


def stayed_overnight(started: datetime, ended: datetime, timezone_name: str) -> bool:
    zone = ZoneInfo(timezone_name)
    return ended.astimezone(zone).date() > started.astimezone(zone).date()


def check_stay(value: str) -> str:
    if value not in {"day", "overnight"}:
        bad("Choose day hike or overnight.")
    return value


def check_cars_where(value: str) -> str:
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if not parts or any(part not in CARS_WHERE for part in parts):
        bad("Choose where the cars were.")
    if len(parts) != len(set(parts)):
        bad("Choose each car answer once.")
    if "didnt_look" in parts and len(parts) > 1:
        bad("I didn't look stands on its own.")
    return ",".join(sorted(parts))


def check_accessible(value: str | None) -> str:
    if value not in ACCESSIBLE:
        bad("Choose whether there were accessible parking spaces.")
    return value


def check_pay(pay_required: str, pay_machine: str | None) -> str | None:
    if pay_required not in PAY_REQUIRED:
        bad("Choose whether parking required a payment.")
    if pay_required != "yes":
        if pay_machine is not None:
            bad("A pay machine answer only applies when parking required payment.")
        return None
    parts = [part.strip() for part in (pay_machine or "").split(",") if part.strip()]
    if not parts or any(part not in PAY_MACHINE for part in parts):
        bad("Choose how someone could pay to park.")
    if len(parts) != len(set(parts)):
        bad("Choose each pay answer once.")
    if "didnt_look" in parts and len(parts) > 1:
        bad("I didn't look stands on its own.")
    if "no_machine" in parts and any(part in MACHINE_WAYS for part in parts):
        bad("No machine can sit with the envelope box only.")
    return ",".join(sorted(parts))


def check_bathroom(exists: str | None, condition: str | None):
    if exists not in BATH_EXISTS:
        bad("Choose whether there were bathrooms.")
    if exists == "yes":
        parts = [part.strip() for part in (condition or "").split(",") if part.strip()]
        if not parts or any(part not in BATH_COND for part in parts):
            bad("Choose the bathroom condition.")
        if len(parts) != len(set(parts)):
            bad("Choose each bathroom answer once.")
        return exists, ",".join(sorted(parts))
    if condition is not None:
        bad("Bathroom condition is only kept when bathrooms were there.")
    return exists, None
