#!/usr/bin/env python3
"""Fetch the shared news feed.json, weather, stocks etc., then embed them into DASHBOARD_CACHE in index.html."""

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode

import requests

LAT = os.environ.get("LAT", "49.19")
LON = os.environ.get("LON", "-122.85")
TIMEOUT = 15
MAX_ITEMS = 5

# The ONLY news/sports source: the public feed the iPhone widget also reads.
# (Built every 3 h by github.com/wghtkbpxwx-a11y/news-widget-feed.)
NEWS_FEED_URL = "https://wghtkbpxwx-a11y.github.io/news-widget-feed/feed.json"

DEFAULT_STOCKS = ["XEQT.TO", "VFV.TO", "AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "GOOGL",
                  # Popular Canadian ETFs so watchlist adds work offline in-car
                  "XGRO.TO", "VGRO.TO", "XBAL.TO", "VBAL.TO", "ZSP.TO", "XIC.TO",
                  # Market indices + CAD/USD for the Live panel markets strip
                  "^GSPTSE", "^GSPC", "^IXIC", "CADUSD=X"]

# DriveBC webcams for the Traffic panel, in display order. The Actions job keeps
# only cameras the API doesn't flag as stale. Images themselves are hotlinked
# live from drivebc.ca; just the metadata is cached. The client shows 4 per
# page with user-favourited cams on page 1.
PREFERRED_CAMERAS = [
    (275, "Port Mann Bridge E"),
    (292, "Port Mann Bridge W"),
    (91,  "Alex Fraser Bridge N"),
    (92,  "Alex Fraser Bridge S"),
    (30,  "Massey Tunnel (Deas)"),
    (33,  "Hwy 99 at 17A Overpass"),
    (313, "Hwy 99 at Mud Bay"),
    (258, "King George at 132 St"),
    (103, "Hwy 10 at King George E"),
    (82,  "Hwy 10 at 152 St W"),
    (79,  "Hwy 10 at 152 St N"),
    (477, "Hwy 15 at 8 Ave N"),
    (279, "Hwy 1 at 232 St E"),
    (212, "Hwy 99 at 8 Ave (White Rock)"),
    (18,  "Lions Gate North"),
    (72,  "Ironworkers Midspan"),
    # Coquihalla (Hwy 5) + Okanagan Connector (Hwy 97C)
    (685, "Coquihalla Summit N"),
    (686, "Coquihalla Summit S"),
    (2,   "Great Bear Snowshed N"),
    (161, "Coquihalla Lakes N"),
    (58,  "Larson Hill N"),
    (251, "Pennask Summit W (97C)"),
    (41,  "Elkhart W (97C)"),
    (497, "Brenda Mine W (97C)"),
]
MAX_CAMERAS = 24
# Lower Mainland + Coquihalla/Connector corridor for traffic events
# (lon_min, lat_min, lon_max, lat_max)
EVENTS_BBOX = "-123.40,48.95,-119.30,50.40"
EVENTS_PER_CAM = 2
EVENT_MATCH_KM = 8.0

def fetch_newsfeed() -> dict | None:
    """Fetch the shared feed.json (single news/sports source for dashboard + widget)."""
    try:
        resp = requests.get(NEWS_FEED_URL, timeout=TIMEOUT, headers={"User-Agent": "tesla-dashboard-cache"})
        resp.raise_for_status()
        feed = resp.json()
        if not isinstance(feed.get("items"), list) or not feed["items"]:
            raise ValueError("feed has no items")
        print(f"  ✓ news feed: {len(feed['items'])} items, {len(feed.get('scores', []))} scores")
        return feed
    except Exception as e:
        print(f"  ✗ news feed: {e}")
        return None


def feed_to_legacy(feed: dict) -> tuple[dict, dict, dict]:
    """Project feed.json into the {url: {status, items}} shape the glance card,
    spoken digest and audio briefing already read — same source, no extra fetches."""
    def pack(items, label):
        out = [{"title": i["title"], "link": i.get("url", ""), "pubDate": i.get("ts", ""), "source": i.get("source", label)}
               for i in items if i.get("title")]
        return {NEWS_FEED_URL + "#" + label: {"status": "ok", "items": out[:8]}} if out else {}
    items = feed.get("items", [])
    news = pack([i for i in feed.get("must_know", [])] + [i for i in items if i.get("section") in ("Local", "National", "World", "Tech")], "news")
    sports = pack([i for i in items if i.get("section") == "Teams"] + feed.get("fantasy_items", []), "sports")
    pharmacy = pack([i for i in items if i.get("section") == "Health"], "health")
    return news, sports, pharmacy


def fetch_weather() -> dict | None:
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        f"&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m"
    )
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        print(f"  ✓ Weather: {data['current']['temperature_2m']}°C")
        return data
    except Exception as e:
        print(f"  ✗ Weather: {e}")
        return None


def fetch_air() -> dict | None:
    """Current air quality (US AQI + PM2.5) from open-meteo's air-quality API."""
    url = (
        f"https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={LAT}&longitude={LON}"
        f"&current=us_aqi,pm2_5"
    )
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        print(f"  ✓ Air quality: AQI {data.get('current', {}).get('us_aqi')}")
        return data
    except Exception as e:
        print(f"  ✗ Air quality: {e}")
        return None


def _haversine_km(lat1, lon1, lat2, lon2):
    import math
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fetch_traffic_events() -> list[dict]:
    """Active DriveBC (Open511) events in the Lower Mainland — the same feed
    that powers @DriveBC posts on X, with per-event updated timestamps."""
    url = f"https://api.open511.gov.bc.ca/events?status=ACTIVE&bbox={EVENTS_BBOX}&limit=500&format=json"
    try:
        resp = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        events = resp.json().get("events", [])
    except Exception as e:
        print(f"  ✗ Traffic events: {e}")
        return []
    out = []
    for e in events:
        geo = e.get("geography") or {}
        coords = geo.get("coordinates")
        if geo.get("type") == "Point" and coords:
            lon, lat = coords[0], coords[1]
        elif geo.get("type") in ("LineString", "MultiPoint") and coords:
            lon, lat = coords[0][0], coords[0][1]
        else:
            continue
        road = ""
        roads = e.get("roads") or []
        if roads:
            road = roads[0].get("name") or ""
            if roads[0].get("from"):
                road += " " + roads[0]["from"]
        out.append({
            "type": (e.get("event_type") or "").title(),
            "severity": e.get("severity") or "UNKNOWN",
            "road": road[:80],
            "desc": (e.get("description") or e.get("headline") or "")[:220],
            "updated": e.get("updated") or e.get("created") or "",
            "lat": lat, "lon": lon,
        })
    print(f"  ✓ Traffic events: {len(out)} active in Lower Mainland")
    return out


def fetch_cameras() -> list[dict]:
    """DriveBC webcam metadata for the preferred crossings, skipping stale cams.
    drivebc.ca is slow from GitHub's runners, so retry with growing timeouts.
    Returns [] on total failure; main() then reuses the cached list and still
    re-attaches fresh events (cam lat/lon is stored for exactly that reason)."""
    by_id = None
    for attempt, tmo in enumerate((20, 30, 45), 1):
        try:
            resp = requests.get("https://www.drivebc.ca/api/webcams/", timeout=tmo,
                                headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            by_id = {c["id"]: c for c in resp.json()}
            break
        except Exception as e:
            print(f"  … cameras attempt {attempt} failed: {e}")
    if by_id is None:
        print("  ✗ Cameras: all attempts failed, will reuse cached list")
        return []
    out = []
    always = {275, 292, 251, 685, 686, 2, 161, 58, 41, 497}  # Port Mann + full Coquihalla/Connector — keep even when flagged stale
    for cam_id, label in PREFERRED_CAMERAS:
        cam = by_id.get(cam_id)
        if not cam:
            continue
        flagged = cam.get("marked_stale") or cam.get("marked_delayed")
        # DriveBC turns a camera "off" when its feed dies; the image endpoint
        # then serves a black "DriveBC.ca" placeholder. is_on is the reliable
        # signal — flag it so the browser can say "offline" instead of showing
        # a confusing black frame (e.g. the Port Mann cams when they drop out).
        offline = cam.get("is_on", True) is False
        if flagged and cam_id not in always:
            continue
        rec = {
            "id": cam_id,
            "name": label,
            "caption": (cam.get("caption") or "")[:120],
            "url": f"https://www.drivebc.ca/images/{cam_id}.jpg",
        }
        if flagged:
            rec["stale"] = True
        if offline:
            rec["offline"] = True
            since = cam.get("last_update_modified") or ""
            try:
                rec["offSince"] = datetime.fromisoformat(since).strftime("%b %-d")
            except Exception:
                pass
        loc = (cam.get("location") or {}).get("coordinates")
        if loc:
            rec["lon"], rec["lat"] = loc[0], loc[1]
        out.append(rec)
        if len(out) >= MAX_CAMERAS:
            break
    print(f"  ✓ Cameras: {len(out)} live")
    return out


def attach_events(cams: list[dict], events: list[dict]) -> None:
    """Attach the nearest active events (within EVENT_MATCH_KM) to each camera
    that carries coordinates. Works on freshly fetched or cached camera lists."""
    for rec in cams:
        rec.pop("events", None)
        if not events or rec.get("lat") is None:
            continue
        near = []
        for ev in events:
            km = _haversine_km(rec["lat"], rec["lon"], ev["lat"], ev["lon"])
            if km <= EVENT_MATCH_KM:
                near.append((km, ev))
        # Live incidents and MAJOR events beat weeks-old minor construction
        near.sort(key=lambda x: (x[1]["type"] != "Incident",
                                 x[1]["severity"] != "MAJOR", x[0]))
        rec["events"] = [
            {"type": ev["type"], "severity": ev["severity"], "road": ev["road"],
             "desc": ev["desc"], "updated": ev["updated"], "km": round(km, 1)}
            for km, ev in near[:EVENTS_PER_CAM]
        ]
    with_ev = sum(1 for c in cams if c.get("events"))
    print(f"  ✓ Events attached: {with_ev}/{len(cams)} cameras")


def fetch_stocks() -> dict:
    """Fetch latest quote for each default stock; returns {sym: chart_response}."""
    out = {}
    for sym in DEFAULT_STOCKS:
        try:
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d"
            resp = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            data = resp.json()
            meta = data["chart"]["result"][0]["meta"]
            # Store only the fields the dashboard actually reads
            out[sym] = {"chart": {"result": [{"meta": {
                "symbol": meta.get("symbol", sym),
                "regularMarketPrice": meta.get("regularMarketPrice"),
                "chartPreviousClose": meta.get("chartPreviousClose"),
            }}]}}
            print(f"  ✓ {sym}: ${meta.get('regularMarketPrice')}")
        except Exception as e:
            print(f"  ✗ {sym}: {e}")
    return out


def fetch_forecast() -> dict | None:
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        f"&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max"
        f"&timezone=auto"
    )
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        days = len(data.get("daily", {}).get("weather_code", []))
        print(f"  ✓ Forecast: {days} days")
        return data
    except Exception as e:
        print(f"  ✗ Forecast: {e}")
        return None


def main():
    print("Fetching weather...")
    weather = fetch_weather()

    print("Fetching 7-day forecast...")
    forecast = fetch_forecast()

    print("Fetching shared news feed...")
    newsfeed = fetch_newsfeed()
    news, sports, pharmacy = feed_to_legacy(newsfeed) if newsfeed else ({}, {}, {})

    print("Fetching stock quotes...")
    stocks = fetch_stocks()

    print("Fetching air quality...")
    air = fetch_air()

    print("Fetching traffic events...")
    traffic_events = fetch_traffic_events()

    print("Fetching traffic cameras...")
    cameras = fetch_cameras()

    # Read current index.html
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Read existing DASHBOARD_CACHE to preserve any keys we didn't update
    m = re.search(r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n", html)
    existing = {}
    if m:
        try:
            existing = json.loads(m.group(1))
        except Exception:
            pass

    # Build new cache, keeping existing data as fallback if live fetch failed
    cache = {
        "weather": weather or existing.get("weather"),
        "forecast": forecast or existing.get("forecast"),
        "news": news if news else existing.get("news", {}),
        "sports": sports if sports else existing.get("sports", {}),
        "pharmacy": pharmacy if pharmacy else existing.get("pharmacy", {}),
        "newsfeed": newsfeed if newsfeed else existing.get("newsfeed"),
        "scores": [],  # structured live scores retired; scores now come from newsfeed
        "stocks": stocks if stocks else existing.get("stocks", {}),
        "air": air or existing.get("air"),
        "cameras": cameras if cameras else existing.get("cameras", []),  # events attached below
        "updated": datetime.now(timezone.utc).isoformat(),
    }

    attach_events(cache["cameras"] or [], traffic_events)

    cache_json = json.dumps(cache, ensure_ascii=False, indent=2)
    new_block = f"var DASHBOARD_CACHE = {cache_json};\n"

    if m:
        html = html[:m.start()] + new_block + html[m.end():]
    else:
        print("ERROR: DASHBOARD_CACHE marker not found in index.html", file=sys.stderr)
        sys.exit(1)

    # Self-check before writing: the assembled file must still match the sacred
    # marker and round-trip as valid JSON. This job commits with [skip ci], so the
    # Validate workflow can't guard it — bail out (leaving the last good index.html
    # untouched) rather than push a cache that would blank the dashboard in-car.
    check = re.search(r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n", html)
    if not check:
        print("ERROR: rewritten DASHBOARD_CACHE no longer matches its marker — aborting", file=sys.stderr)
        sys.exit(1)
    try:
        json.loads(check.group(1))
    except Exception as e:
        print(f"ERROR: rewritten DASHBOARD_CACHE is not valid JSON ({e}) — aborting", file=sys.stderr)
        sys.exit(1)
    if not (cache.get("weather") or cache.get("forecast")):
        print("  ⚠ warning: both weather and forecast are empty this run (kept as-is)")

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

    forecast_days = len((cache.get("forecast") or {}).get("daily", {}).get("weather_code", []))
    print(f"Done. newsfeed={'ok' if cache.get('newsfeed') else 'missing'}, forecast={forecast_days} days, stocks={len(cache['stocks'])} tickers")


if __name__ == "__main__":
    main()
