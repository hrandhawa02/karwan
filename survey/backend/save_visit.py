from datetime import datetime, timezone

from pydantic import BaseModel, field_validator

from survey.backend.allowed_answers import (
    blank,
    check_accessible,
    check_arrival_window,
    check_bathroom,
    check_cars_where,
    check_pay,
    check_stay,
    parse_arrived,
)


class VisitIn(BaseModel):
    place_id: int
    arrived_at: str
    stay: str
    cars_where: str
    accessible: str
    pay_required: str
    pay_machine: str | None = None
    bathroom_exists: str | None = None
    bathroom_condition: str | None = None

    @field_validator("pay_machine", "bathroom_exists", "bathroom_condition", mode="before")
    @classmethod
    def empty_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and value.strip() == "":
            return None
        return value


def visit_row(place, body: VisitIn) -> dict:
    started = parse_arrived(body.arrived_at)
    zone = place["timezone"]
    check_arrival_window(started, zone)
    stay = check_stay(body.stay)
    cars = check_cars_where(body.cars_where)
    accessible = check_accessible(blank(body.accessible))
    pay_machine = check_pay(body.pay_required, blank(body.pay_machine))
    bathroom_exists, bathroom_condition = check_bathroom(
        blank(body.bathroom_exists),
        blank(body.bathroom_condition),
    )
    return {
        "place_id": place["id"],
        "arrived_at": started.isoformat(),
        "timezone": zone,
        "cars_where": cars,
        "accessible": accessible,
        "pay_required": body.pay_required,
        "pay_machine": pay_machine,
        "overnight": "yes" if stay == "overnight" else "no",
        "bathroom_exists": bathroom_exists,
        "bathroom_condition": bathroom_condition,
        "capacity": place["capacity"],
        "fee": place["fee"],
        "opening_hours": place["opening_hours"],
        "surface": place["surface"],
        "toilet": place["toilet"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def insert_visit(conn, row: dict) -> None:
    names = list(row)
    columns = ", ".join(names)
    marks = ", ".join("?" for _ in names)
    values = tuple(row[name] for name in names)
    conn.execute(
        f"INSERT INTO visits ({columns}) VALUES ({marks})",
        values,
    )


def save_visit(conn, place, body: VisitIn) -> None:
    insert_visit(conn, visit_row(place, body))
