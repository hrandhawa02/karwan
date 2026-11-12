"""Same-origin PMTiles for local dev (avoids browser CORS on third-party hosts)."""

from __future__ import annotations

import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

# v4 basemap; range reads only (full file is ~125 GB). Do not use build.protomaps.com (404, no CORS).
DEFAULT_BASEMAP_UPSTREAM = (
    "https://data.source.coop/protomaps/openstreetmap/v4.pmtiles"
)

BASEMAP_PMTILES_PATH = "/api/v1/pmtiles/basemap"

_PASS_HEADERS = (
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
)


def basemap_local_path(root: Path) -> Path | None:
    raw = os.environ.get("KARWAN_BASEMAP_PATH", "").strip()
    if raw:
        path = Path(raw).expanduser()
        if path.is_file():
            return path
        return None
    candidate = root / "data" / "basemap.pmtiles"
    if candidate.is_file():
        return candidate
    return None


def basemap_upstream_url() -> str:
    """Upstream for the local Range proxy only (.pmtiles archive, not TileJSON)."""
    upstream = os.environ.get("KARWAN_BASEMAP_UPSTREAM", "").strip()
    if upstream:
        return upstream
    configured = os.environ.get("KARWAN_BASEMAP_URL", "").strip()
    if configured.endswith(".pmtiles") or configured.startswith("pmtiles://"):
        return configured
    return DEFAULT_BASEMAP_UPSTREAM


def manifest_basemap_url(root: Path) -> str:
    """Browser-facing basemap URL: TileJSON Worker, .pmtiles, or same-origin proxy."""
    configured = os.environ.get("KARWAN_BASEMAP_URL", "").strip()
    if configured:
        return configured
    if basemap_local_path(root):
        return BASEMAP_PMTILES_PATH
    return BASEMAP_PMTILES_PATH


def _response_headers(upstream_headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for name in _PASS_HEADERS:
        value = upstream_headers.get(name)
        if value:
            out[name] = value
    if "Accept-Ranges" not in out:
        out["Accept-Ranges"] = "bytes"
    return out


def serve_basemap_pmtiles(root: Path, request: Request) -> Response:
    local = basemap_local_path(root)
    if local:
        return FileResponse(
            local,
            media_type="application/octet-stream",
            stat_result=os.stat(local),
            headers={"Accept-Ranges": "bytes"},
        )

    upstream = basemap_upstream_url()
    req = urllib.request.Request(upstream, method=request.method)
    req.add_header("User-Agent", "KarwanMapTiles/1.0")
    for header in ("Range", "If-Match", "If-None-Match"):
        value = request.headers.get(header)
        if value:
            req.add_header(header, value)

    try:
        upstream_resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as exc:
        body = exc.read(4096) if exc.fp else b""
        raise HTTPException(status_code=exc.code, detail=body.decode("utf-8", "replace")) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Basemap upstream failed: {exc.reason}") from exc

    headers = _response_headers(upstream_resp.headers)
    if request.method == "HEAD":
        upstream_resp.close()
        return Response(status_code=upstream_resp.status, headers=headers)

    return StreamingResponse(
        upstream_resp,
        status_code=upstream_resp.status,
        headers=headers,
        media_type=headers.get("Content-Type", "application/octet-stream"),
    )
