#!/usr/bin/env python3
"""Fetch RSS feeds and weather, then embed them into DASHBOARD_CACHE in index.html."""

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlencode

import requests

LAT = os.environ.get("LAT", "49.19")
LON = os.environ.get("LON", "-122.85")
TIMEOUT = 15
MAX_ITEMS = 5

NEWS_FEEDS = {
    # Local (BC)
    "https://globalnews.ca/bc/feed/": "Global BC",
    "https://www.cbc.ca/cmlink/rss-canada-britishcolumbia": "CBC BC",
    # National
    "https://www.cbc.ca/cmlink/rss-topstories": "CBC News",
    "https://globalnews.ca/feed/": "Global News",
    "https://nationalpost.com/feed/": "National Post",
    # World
    "https://feeds.bbci.co.uk/news/world/rss.xml": "BBC World",
}

SPORTS_FEEDS = {
    "https://www.espn.com/espn/rss/news": "ESPN",
    "https://www.sportsnet.ca/feed/": "Sportsnet",
    "https://www.cfl.ca/rss/": "CFL.ca",
    "https://www.mlb.com/feeds/news/rss.xml": "MLB.com",
}


def parse_rss(content: bytes, source: str) -> list[dict]:
    """Parse RSS/Atom XML and return list of item dicts."""
    items = []
    try:
        root = ET.fromstring(content)
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        # RSS 2.0
        for item in root.findall(".//item"):
            def txt(tag):
                el = item.find(tag)
                return el.text.strip() if el is not None and el.text else ""
            title = txt("title")
            link = txt("link")
            pub = txt("pubDate")
            if not title or not link:
                continue
            # Normalise pubDate to "YYYY-MM-DD HH:MM:SS"
            try:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(pub)
                pub = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                pub = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            items.append({"title": title, "link": link, "pubDate": pub, "source": source})

        # Atom
        if not items:
            for entry in root.findall("atom:entry", ns):
                def atxt(tag):
                    el = entry.find(f"atom:{tag}", ns)
                    return el.text.strip() if el is not None and el.text else ""
                title = atxt("title")
                link_el = entry.find("atom:link", ns)
                link = (link_el.get("href") or "") if link_el is not None else ""
                pub = atxt("updated") or atxt("published")
                if not title or not link:
                    continue
                try:
                    dt = datetime.fromisoformat(pub.rstrip("Z"))
                    pub = dt.strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    pub = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                items.append({"title": title, "link": link, "pubDate": pub, "source": source})
    except Exception as e:
        print(f"  XML parse error: {e}", file=sys.stderr)
    return items[:MAX_ITEMS]


def fetch_feed(url: str, source: str) -> dict | None:
    """Fetch one RSS feed URL and return {status, items} or None on failure."""
    try:
        resp = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        items = parse_rss(resp.content, source)
        if items:
            print(f"  ✓ {source}: {len(items)} items")
            return {"status": "ok", "items": items}
        print(f"  ✗ {source}: no items parsed")
        return None
    except Exception as e:
        print(f"  ✗ {source}: {e}")
        return None


def fetch_weather() -> dict | None:
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        f"&current=temperature_2m,weather_code,is_day"
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


def main():
    print("Fetching weather...")
    weather = fetch_weather()

    print("Fetching news feeds...")
    news = {}
    for url, source in NEWS_FEEDS.items():
        result = fetch_feed(url, source)
        if result:
            news[url] = result

    print("Fetching sports feeds...")
    sports = {}
    for url, source in SPORTS_FEEDS.items():
        result = fetch_feed(url, source)
        if result:
            sports[url] = result

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
        "news": news if news else existing.get("news", {}),
        "sports": sports if sports else existing.get("sports", {}),
        "updated": datetime.now(timezone.utc).isoformat(),
    }

    cache_json = json.dumps(cache, ensure_ascii=False, indent=2)
    new_block = f"var DASHBOARD_CACHE = {cache_json};\n"

    if m:
        html = html[:m.start()] + new_block + html[m.end():]
    else:
        print("ERROR: DASHBOARD_CACHE marker not found in index.html", file=sys.stderr)
        sys.exit(1)

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Done. news={len(cache['news'])} sources, sports={len(cache['sports'])} sources")


if __name__ == "__main__":
    main()
