# Karwan

Karwan is a record of a visit to a trailhead. People mark where they parked, and the page keeps what they found.

This repository is the trailhead page. The phone app comes after the page has real reports.

## Research page

People open one worldwide link on their phone. The map shows trailheads and parking lots already on OpenStreetMap for the area on screen. They pick one, or drop a pin, and answer only what the map does not already know.

## Folders

`survey/` is this trailhead survey. The page and the server live here together, in one repository.

`survey/frontend/` is the page someone sees. `index.html` is the page shell, `style.css` loads the look from `survey/frontend/css/`, and `main.js` moves between questions. Each question is a file in `survey/frontend/screens/`. Privacy is `/privacy`. Terms are `/terms`.

`survey/backend/` stores the visit. `server.py` is the website. `database.py` opens the database. `trailhead.py` is the sample trailhead. `allowed_answers.py` is which choices count. `save_visit.py` writes the visit.

The page posts to `/api/v1/visits`. That `v1` is the contract a later phone app can keep using. The project version in `pyproject.toml` is separate: it is `0.1.0` today. `uv.lock` pins the exact Python libraries.

The iPhone app can become its own folder, or its own repository, when it is a separate program that calls this API.

## Build order

1. Research page: map, search near the map, visit form, save each report. Submissions stay private.
2. iPhone app. Sharing counts or summaries with other people is a feature of the app, not of this page.

No account, email, or fee on the research page. Nothing is written back to OpenStreetMap in this phase. The research page does not show other people’s reports.

This repository is the code for that page. It has no license that lets other people reuse it. `docs/` and `karwan.db` stay off a public copy. Secrets stay in `.env`, which is ignored.

## Try the survey

```bash
uv sync
uv run uvicorn survey.backend.server:app --reload
```

Open http://127.0.0.1:8000. This version uses Mount Si Trailhead Parking as a sample place and saves each visit in `karwan.db` on this computer. Choosing any trailhead on a map is the next step, before the link is posted publicly.
