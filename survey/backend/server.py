import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from survey.backend.database import connect
from survey.backend.form_gate import form_is_open
from survey.backend.osm import (
    MapLookupFailed,
    find_town,
    map_view,
    search_nearby,
    store_place,
)
from survey.backend.trailhead import place_public, sample_row
from survey.backend.save_visit import VisitIn, save_visit

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "survey" / "frontend"
API_V1 = "/api/v1"
VISITS_PATH = f"{API_V1}/visits"
log = logging.getLogger("karwan")


def configure_log() -> None:
    if log.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False


configure_log()


def visit_post(request: Request) -> bool:
    return request.method == "POST" and request.url.path == VISITS_PATH


@asynccontextmanager
async def lifespan(_app):
    if os.environ.get("RAILWAY_ENVIRONMENT"):
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    with connect():
        pass
    log.info("form %s", "open" if form_is_open() else "closed")
    yield


app = FastAPI(
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def keep_private(request, call_next):
    if visit_post(request) and not form_is_open():
        log.warning("visit refused status=403 reason=closed")
        response = JSONResponse(status_code=403, content={"detail": "closed"})
    else:
        response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return response


@app.exception_handler(HTTPException)
async def quiet_visit_error(request: Request, exc: HTTPException):
    if visit_post(request):
        log.warning(
            "visit refused status=%s reason=%s",
            exc.status_code,
            exc.detail,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": "This visit could not be saved."},
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def quiet_invalid_visit(request: Request, _exc: RequestValidationError):
    if visit_post(request):
        log.warning("visit refused status=422 reason=invalid body")
        return JSONResponse(
            status_code=400,
            content={"detail": "This visit could not be saved."},
        )
    return JSONResponse(status_code=422, content={"detail": "invalid"})


@app.get("/")
def home():
    return FileResponse(FRONTEND / "home.html")


@app.get("/announcements")
def announcements():
    return FileResponse(FRONTEND / "announcements.html")


@app.get("/survey")
@app.get("/survey/")
def survey_page():
    return FileResponse(FRONTEND / "index.html")


app.mount("/survey", StaticFiles(directory=FRONTEND), name="frontend")


@app.get("/privacy")
def privacy():
    return FileResponse(FRONTEND / "privacy.html")


@app.get("/terms")
def terms():
    return FileResponse(FRONTEND / "terms.html")


@app.get(f"{API_V1}/form")
def form_status():
    return {"open": form_is_open()}


class PlaceIn(BaseModel):
    osm_type: str | None = None
    osm_id: str | None = None
    name: str | None = None
    trail_name: str | None = None
    lat: float | None = None
    lon: float | None = None


@app.get(f"{API_V1}/map")
def map_places(south: float, west: float, north: float, east: float):
    try:
        return map_view(south, west, north, east)
    except MapLookupFailed:
        raise HTTPException(
            status_code=503,
            detail="Places could not be loaded.",
        )


@app.get(f"{API_V1}/map/search")
def map_search(q: str, lat: float, lon: float):
    try:
        places = search_nearby(q, lat, lon)
    except MapLookupFailed:
        places = []
    moved = None if places else find_town(q)
    return {"places": places, "moved": moved}


@app.post(f"{API_V1}/places")
def choose_place(body: PlaceIn):
    try:
        with connect() as conn:
            row = store_place(conn, body)
    except MapLookupFailed:
        raise HTTPException(
            status_code=503,
            detail="This place could not be opened.",
        )
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="That place is not on this form.",
        )
    return place_public(row)


@app.get(f"{API_V1}/sample-place")
def sample_place():
    with connect() as conn:
        row = sample_row(conn)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="The sample trailhead is missing.",
        )
    return place_public(row)


@app.post(f"{API_V1}/visits")
def create_visit(body: VisitIn):
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM places WHERE id = ?",
            (body.place_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=404,
                detail="That place is not on this form.",
            )
        save_visit(conn, row, body)
    log.info("visit saved place=%s", body.place_id)
    return {"saved": True}
