import os


def form_is_open() -> bool:
    value = os.environ.get("KARWAN_OPEN", "1").strip().lower()
    return value not in {"0", "false", "no", "closed", "off"}
